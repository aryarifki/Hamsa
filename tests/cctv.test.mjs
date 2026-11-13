import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://hamsa:hamsa@127.0.0.1:5432/hamsa_test";
process.env.HAMSA_SECRET = "cctv-test-secret-not-used-anywhere-else";
process.env.HAMSA_CCTV_ALLOW_LOCAL_MEDIA = "true";

const storage = mkdtempSync(join(tmpdir(), "hamsa-cctv-"));
process.env.HAMSA_STORAGE_DIR = storage;

const db = await import("../lib/db.ts");
const crypto = await import("../lib/crypto.ts");
const users = await import("../lib/users.ts");
const service = await import("../lib/cctv/service.ts");
const ffmpeg = await import("../lib/cctv/ffmpeg.ts");

const W = 320;
const H = 240;

const blank = () => Buffer.alloc(W * H, 0);
const withBlock = () => {
  const frame = blank();
  for (let y = 100; y < 140; y += 1) {
    for (let x = 100; x < 140; x += 1) frame[y * W + x] = 255;
  }
  return frame;
};

function fakeRunner({ mode = "ok", frames = [] } = {}) {
  let calls = 0;
  const runner = async (args) => {
    calls += 1;
    if (args.includes("-version")) {
      return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false };
    }
    if (mode === "auth") {
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: "rtsp://operator:s3cret@10.0.0.9:554/: Server returned 401 Unauthorized",
        timedOut: false,
      };
    }
    if (args.includes("rawvideo")) {
      return {
        code: 0,
        stdout: Buffer.concat(frames.map((frame) => Buffer.from(frame))),
        stderr: "",
        timedOut: false,
      };
    }
    const output = args[args.length - 1];
    if (!output.endsWith(".jpg")) {
      return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false };
    }
    writeFileSync(output, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false };
  };
  return { runner, calls: () => calls };
}

function fakeTransport() {
  return async (_url, body) => {
    if (body.includes("GetCapabilities")) {
      return {
        status: 200,
        body: `<Envelope><Body><GetCapabilitiesResponse><Capabilities><Events>
          <XAddr>http://10.0.0.9:8000/onvif/events</XAddr>
        </Events></Capabilities></GetCapabilitiesResponse></Body></Envelope>`,
      };
    }
    if (body.includes("CreatePullPointSubscription")) {
      return {
        status: 200,
        body: `<Envelope><Body><CreatePullPointSubscriptionResponse><SubscriptionReference>
          <Address>http://10.0.0.9:8000/onvif/subscription</Address>
        </SubscriptionReference></CreatePullPointSubscriptionResponse></Body></Envelope>`,
      };
    }
    if (body.includes("PullMessages")) {
      return {
        status: 200,
        body: `<Envelope><Body><PullMessagesResponse>
          <NotificationMessage><Topic>tns1:RuleEngine/CellMotionDetector/Motion</Topic>
            <Message><Data><SimpleItem Name="IsMotion" Value="true"/></Data></Message>
          </NotificationMessage>
        </PullMessagesResponse></Body></Envelope>`,
      };
    }
    return { status: 500, body: "" };
  };
}

let admin;
let analyst;
let other;

before(async () => {
  await db.ensureSchema();
  await db.resetDatabase();

  admin = await users.createUser({
    email: "admin@cctv.test",
    name: "Admin",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "admin",
  });
  analyst = await users.createUser({
    email: "analyst@cctv.test",
    name: "Analyst",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
  });
  other = await users.createUser({
    email: "other@cctv.test",
    name: "Other",
    passwordHash: crypto.hashPassword("a-long-test-password"),
    role: "analyst",
  });
});

after(async () => {
  await db.closePool();
  rmSync(storage, { recursive: true, force: true });
});

test("enrolment splits credentials out of the URL and encrypts them", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Loading bay",
    streamUrl: "rtsp://operator:s3cret@10.0.0.9:554/Streaming/Channels/101",
    onvifHost: "10.0.0.9:8000",
    intervalSeconds: 60,
  });

  assert.equal(camera.rtsp_url, "rtsp://10.0.0.9:554/Streaming/Channels/101");
  assert.equal(camera.username_enc.startsWith("v1."), true);
  assert.equal(crypto.decryptSecret(camera.username_enc), "operator");
  assert.equal(crypto.decryptSecret(camera.password_enc), "s3cret");
  assert.equal(camera.created_by, analyst.id);
  assert.equal(camera.snapshot_interval_s, 60);

  const auditRow = await db.one(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'camera.create' AND entity_id = ?",
    camera.id,
  );
  assert.equal(auditRow.n, 1);
});

test("ownership is enforced for analysts and relaxed for admins", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Gate",
    streamUrl: "rtsp://10.0.0.10:554/stream",
  });

  assert.equal(await service.cameraForUser(camera.id, other), undefined);
  assert.ok(await service.cameraForUser(camera.id, admin));
  assert.equal((await service.listCameras(other)).length, 0);
});

test("a reachable stream becomes online", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Online camera",
    streamUrl: "rtsp://10.0.0.11:554/stream",
  });

  const { runner } = fakeRunner();
  const result = await service.checkCamera(camera.id, analyst, { runner });
  assert.equal(result.ok, true);
  assert.equal(result.status, "online");

  const row = await db.one("SELECT status, last_error FROM cameras WHERE id = ?", camera.id);
  assert.equal(row.status, "online");
  assert.equal(row.last_error, null);
});

test("authentication failure disables the camera, alerts admins and audits it", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Wrong password",
    streamUrl: "rtsp://10.0.0.12:554/stream",
  });

  const { runner } = fakeRunner({ mode: "auth" });
  const result = await service.checkCamera(camera.id, analyst, { runner });

  assert.equal(result.ok, false);
  assert.equal(result.status, "disabled_auth");

  const row = await db.one("SELECT * FROM cameras WHERE id = ?", camera.id);
  assert.equal(row.status, "disabled_auth");
  assert.match(row.disabled_reason, /Authentication failed/);
  assert.doesNotMatch(row.last_error, /s3cret/, "credentials must be redacted from persisted errors");

  const notifications = await db.one(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND kind = 'camera.disabled'",
    admin.id,
  );
  assert.equal(notifications.n, 1);

  const audits = await db.one(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'camera.disabled' AND entity_id = ?",
    camera.id,
  );
  assert.equal(audits.n, 1);

  // A disabled camera is not touched again, even if the stream is reachable.
  const reachable = fakeRunner();
  const retry = await service.captureCamera(camera.id, analyst, { runner: reachable.runner });
  assert.equal(retry.ok, false);
  assert.equal(retry.kind, "auth");
  assert.equal(reachable.calls(), 0);
});

test("capture writes a private snapshot and records MOG2 motion", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Motion camera",
    streamUrl: "rtsp://10.0.0.13:554/stream",
    motionThreshold: 0.005,
  });

  const frames = Array.from({ length: 13 }, (_, index) => (index === 12 ? withBlock() : blank()));
  const { runner } = fakeRunner({ frames });
  const result = await service.captureCamera(camera.id, analyst, { runner });

  assert.equal(result.ok, true);
  assert.equal(result.motionDetected, true);
  assert.ok(result.motionRatio > 0.005);

  const snapshot = await db.one("SELECT * FROM camera_snapshots WHERE id = ?", result.snapshotId);
  assert.equal(snapshot.camera_id, camera.id);
  assert.equal(snapshot.motion_detected, 1);
  assert.ok(snapshot.file_path.startsWith(storage));
  assert.equal(readdirSync(join(storage, "cameras", camera.id)).length, 1);

  const events = await db.one(
    "SELECT COUNT(*)::int AS n FROM camera_events WHERE camera_id = ? AND source = 'mog2'",
    camera.id,
  );
  assert.equal(events.n, 1);

  const row = await db.one("SELECT status, last_snapshot_at FROM cameras WHERE id = ?", camera.id);
  assert.equal(row.status, "online");
  assert.ok(row.last_snapshot_at);
});

test("ONVIF PullPoint notifications become camera events", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "ONVIF camera",
    streamUrl: "rtsp://10.0.0.14:554/stream",
    onvifHost: "10.0.0.14:8000",
  });

  const result = await service.pollCameraEvents(camera.id, analyst, { transport: fakeTransport() });
  assert.equal(result.ok, true);
  assert.equal(result.motionEvents, 1);

  const event = await db.one(
    "SELECT * FROM camera_events WHERE camera_id = ? AND source = 'onvif'",
    camera.id,
  );
  assert.equal(event.type, "motion");

  const row = await db.one("SELECT onvif_events_url, onvif_sub_url FROM cameras WHERE id = ?", camera.id);
  assert.equal(row.onvif_events_url, "http://10.0.0.9:8000/onvif/events");
  assert.equal(row.onvif_sub_url, "http://10.0.0.9:8000/onvif/subscription");
});

test("deleting a camera removes its metadata and snapshot files", async () => {
  const camera = await service.createCamera({
    user: analyst,
    name: "Disposable",
    streamUrl: "rtsp://10.0.0.15:554/stream",
  });

  const { runner } = fakeRunner({ frames: [] });
  const captured = await service.captureCamera(camera.id, analyst, { runner });
  assert.equal(captured.ok, true);
  assert.equal(readdirSync(join(storage, "cameras", camera.id)).length, 1);

  await service.deleteCamera(camera.id, analyst);
  assert.equal(await service.cameraForUser(camera.id, analyst), undefined);
  assert.throws(() => readdirSync(join(storage, "cameras", camera.id)));
});

test("production camera checks reject private network addresses", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.HAMSA_CCTV_ALLOW_PRIVATE_NETWORKS;
  await assert.rejects(
    () => ffmpeg.assertMediaInput("http://127.0.0.1:3010/api/health"),
    /Private and loopback/,
  );
  process.env.NODE_ENV = previous;
});
