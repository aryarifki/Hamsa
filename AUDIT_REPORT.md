# Hamsa — Laporan Audit Fungsional & Keamanan

**Target:** `/root/Hamsa` (Hamsa OSINT Intelligence Console v1.1.0)
**Tanggal audit:** 13 November 2026
**Metode:** audit statis (baca kode) + eksekusi nyata (PostgreSQL lokal, `next start`, `node .next/standalone/server.js`, Playwright/Chromium, curl, ffmpeg)
**Status bukti:** setiap klaim diberi label `confirmed` (ada bukti eksekusi), `likely` (indikasi kuat, tidak sepenuhnya tereproduksi), atau `unverified` (tidak dijalankan).

## Status remediasi

Per 13 November 2026, temuan prioritas F-01 sampai F-06 dan F-08 sampai F-11 telah diperbaiki di working tree dan diverifikasi dengan typecheck, build produksi, serta **44/44 test pass**. F-07, F-12, dan F-13 bersifat kualitas/operasional dan belum diubah.

---

## 1. Ringkasan eksekutif

Aplikasi **berjalan dan seluruh modul inti terbukti bekerja dengan data asli**, bukan data seed:

| Area | Verdict |
|---|---|
| Build, typecheck, test | **Lulus** — typecheck exit 0, 41/41 test pass, build produksi sukses (30 route) |
| 5 modul lookup (phone/ip/email/username/telegram) | **Berfungsi dengan sumber eksternal/offline asli** |
| Workspace (cases, history, export, print, watchlist, billing) | **Berfungsi end-to-end** |
| Aset (devices, geofence, notifikasi, CCTV) | **Berfungsi end-to-end**, CCTV diuji dengan file media nyata + ffmpeg |
| Auth & otorisasi | **Berfungsi**, tetapi ada 1 celah High dan 1 Medium |
| Kualitas keamanan umum | SQLi/XSS/IDOR/CSRF tidak ditemukan; header & enkripsi secret baik |

**Satu temuan High dan satu Medium yang harus diperbaiki sebelum dipakai di luar localhost:**

1. **High — Rate-limit login/register bisa di-bypass dengan header `X-Forwarded-For`** — 12 percobaan login gagal dengan XFF berbeda semuanya diproses; tanpa spoof, percobaan ke-11 sudah diblokir. Dapat dipakai untuk credential stuffing dan farming kredit signup (25 kredit/akun).
2. **Medium — Logout tidak menavigasi ke `/login` di host selain `localhost`** — redirect absolut dari `req.url` menghasilkan `Location: http://localhost:3010/login` / `http://0.0.0.0:3012/login`. **Sesi tetap ter-revoke dan cookie terhapus** (diverifikasi di database), tetapi Chrome memblokir navigasi karena CSP `form-action 'self'`, sehingga pengguna tertinggal di halaman lama yang masih terlihat seperti sudah login.

Tidak ada temuan kritis (RCE, SQLi, kebocoran kredensial plaintext, akses lintas-tenant ke data lookup).

---

## 2. Lingkup & metode

**Lingkup:** seluruh route halaman, API, server action, library intel, CCTV, tracking, auth, billing, dan admin pada repo lokal. Tidak ada perubahan kode sumber; hanya `.env`, database, storage, dan artefak di `/tmp/opencode/hamsa-audit/`.

**Yang dijalankan:**

```
npm ci
npm run migrate            # 3 migrasi (001_notifications, 002_camera_monitor, 003_consent_geofencing)
npm run typecheck          # exit 0
npm test                   # 41 tests, 41 pass, 0 fail
npm run build              # sukses, 30 route
npm audit --omit=dev       # 0 vulnerabilities
```

**Runtime uji:**
- `next start -p 3010` (instance utama)
- `next start -p 3011` dengan `HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true` (lab CCTV)
- `node .next/standalone/server.js` pada port 3012 (mensimulasikan Docker)
- PostgreSQL lokal, database `hamsa` + `hamsa_test`
- Browser: Chromium (playwright-core, `/root/.cache/ms-playwright/chromium-1234`)

**Yang TIDAK dijalankan:** `docker compose up` (image tidak dibangun), kamera RTSP fisik, provider berbayar (Numverify/HIBP/ipinfo) dengan key asli, load test, dan `npm run seed` (data dummy sengaja tidak dipakai).

---

## 3. Matriks fitur & kesesuaian data

### 3.1 Modul intel — sumber data asli

| Modul | Target uji | Hasil nyata | Sumber | Status |
|---|---|---|---|---|
| Phone | `+62 812 3456 7890` | valid, E.164 `+6281234567890`, national `0812-3456-7890`, `MOBILE`, carrier **Telkomsel**, country ID | libphonenumber-js (offline) + prefix table + sinyal | `confirmed` |
| Phone (invalid) | `12345` | `valid=false`, `possible=false`, warning `NUMVERIFY_KEY` tidak diset | offline | `confirmed` |
| IP | `8.8.8.8` | US / California / San Jose, **AS15169 Google LLC**, reverse `dns.google`, proxy/hosting false | ipwho.is | `confirmed` |
| IP | `1.1.1.1` | **AS13335 Cloudflare**, tampil di UI | ipwho.is | `confirmed` |
| IP | `127.0.0.1` | `scope=loopback`, `provider=none`, tanpa lookup eksternal | klasifikasi lokal | `confirmed` |
| IP (invalid) | `999.999.999.999` | lookup dibuat, biaya tetap dipotong, hasil menandai input invalid | lokal | `confirmed` |
| Email | `linus@linuxfoundation.org` | MX **smtp.google.com**, `hasMx=true`, `disposable=false`, gravatar hash dihitung, `gravatarExists=false`, warning HIBP | DNS MX + heuristik | `confirmed` |
| Email | `test@mailinator.com` | `disposable=true`, MX ada | DNS + daftar disposabel | `confirmed` |
| Username | `torvalds` | **22 situs dicek, 13 found, 7 absent, 2 unknown** (npm 403 → unknown, bukan false) | probe HTTP langsung | `confirmed` |
| Telegram | `durov` | **20 post asli** (tanggal, URL `t.me/durov/<id>`, teks) | `t.me/s/<channel>` | `confirmed` |
| Telegram + keyword | `durov` + `Telegram` | **15 post** cocok (case-insensitive) | idem | `confirmed` |

Catatan: warning provider tidak dikonfigurasi tampil benar di UI/JSON, jadi kekosongan data tidak menyamar sebagai "tidak ada temuan".

### 3.2 Workspace

| Fitur | Bukti | Status |
|---|---|---|
| Login form + session cookie | `httpOnly=true`, `secure=true`, `sameSite=Lax`, TTL 12 jam | `confirmed` |
| Dashboard | 200, kredit & navigasi tampil | `confirmed` |
| History | 15 baris milik user, UI memuat maksimal 200 (default fungsi 100), **tanpa filter/pagination** (`?q=` & `?module=` diabaikan) | `confirmed` |
| History detail | 200, target + daftar sumber tampil | `confirmed` |
| Export JSON / Markdown | `200` (1954 B / 1365 B), isi terstruktur | `confirmed` |
| Print view | 200 | `confirmed` |
| Watchlist add | baris `9.9.9.9` muncul | `confirmed` |
| Cron watchlist | `checked=1 errors=0`, status `ok`, `last_run_at` terisi | `confirmed` |
| Cron secret salah | `401` | `confirmed` |
| Case create | `H-2026-0001`, `open`, authorization ref tersimpan | `confirmed` |
| Case attach evidence | 1 item terlampir, link ke history | `confirmed` |
| Case detail lintas user | `404` (IDOR tertutup) | `confirmed` |
| Billing | halaman 200, ledger & saldo tampil | `confirmed` |
| API key mint | format `hk_...`, hanya hash SHA-256 yang disimpan | `confirmed` |
| API key Bearer lookup | `201`, hasil `Quad9` valid; key salah `401` | `confirmed` |
| Admin | users, providers, grants, audit tampil; tidak ada key plaintext | `confirmed` |
| Register | akun `analyst` dibuat, **25 kredit** | `confirmed` |
| Ganti password | sukses, sesi lain `307 → /login` dan API `401` (revoked) | `confirmed` |
| Role admin | user non-admin diarahkan ke `/` (bukan 403, tapi tertutup) | `confirmed` |

### 3.3 Aset: devices, geofence, notifikasi

| Fitur | Bukti | Status |
|---|---|---|
| Enroll device | token 36 char dikembalikan sekali | `confirmed` |
| Ping dalam fence | `200`, `fences=[true]` | `confirmed` |
| Ping luar fence | `200`, `fences=[false]`, transisi `exit` | `confirmed` |
| Token invalid | `403` seragam | `confirmed` |
| Notifikasi | `geofence.enter` & `geofence.exit` muncul, mark-read bekerja | `confirmed` |
| Rate limit ping | diuji suite: 60/menit | `confirmed` (test) |

### 3.4 CCTV

| Fitur | Bukti | Status |
|---|---|---|
| Enroll kamera file lokal | `file:///tmp/.../lab-cam.mp4` diterima (lab mode) | `confirmed` |
| Check stream | status `online` setelah ffmpeg probe | `confirmed` |
| Snapshot | JPEG **24.367 byte**, thumbnail dirender | `confirmed` |
| Motion detection | **1.12%** pada klip uji | `confirmed` |
| Otorisasi snapshot | anon `401`, viewer `404`, admin `200` | `confirmed` |
| Path traversal ID | `..%2f..%2fetc%2fpasswd` → `404` | `confirmed` |
| Storage | direktori `700`, file `644`, di luar `public/`, `/storage/` → `404` | `confirmed` |
| Cron cameras | Bearer & `x-cron-secret` → `200`; secret salah `401` | `confirmed` |

---

## 4. Temuan

Ringkasan:

| ID | Severity | Temuan | Label |
|---|---|---|---|
| F-01 | Medium | Logout tidak menavigasi ke `/login` di host selain `localhost` (sesi tetap ter-revoke) | confirmed |
| F-02 | **High** | Bypass rate-limit auth via `X-Forwarded-For` | confirmed |
| F-03 | Medium | Race condition cron watchlist → lookup & debit berulang | confirmed |
| F-04 | Medium | Geofence "org-wide" milik analyst berlaku lintas user | confirmed |
| F-05 | Medium | SSRF via URL stream kamera (private/loopback diizinkan) | confirmed |
| F-06 | Low | Inkonsistensi input media lokal (path absolut vs `file://`) | confirmed |
| F-07 | Low | Telegram `0 post` tanpa warning saat parsing gagal | likely |
| F-08 | Low | Audit ganti password tercatat sebagai `auth.login` | confirmed |
| F-09 | Low | Admin bisa menurunkan role sendiri; tidak ada guard last-admin | confirmed (kode) |
| F-10 | Low | Registrasi membocorkan email sudah terdaftar | confirmed |
| F-11 | Low | Input invalid tetap dikenai biaya kredit | confirmed |
| F-12 | Info | Rate limiter in-process (tidak berlaku multi-instance) | confirmed (kode) |
| F-13 | Info | `script-src 'unsafe-inline'` pada CSP | confirmed |

---

### F-01 — Logout tidak menavigasi ke `/login` di host selain `localhost` (Medium, `confirmed`)

**Lokasi:** `app/api/auth/logout/route.ts:17`

```ts
return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
```

`req.url` di Next.js dibangun dari alamat internal proses, bukan header `Host`.

**Bukti eksekusi:**

```
# request dengan Host: 127.0.0.1:3010
HTTP/1.1 303 See Other
location: http://localhost:3010/login

# request dengan Host: example.com  → tetap
location: http://localhost:3010/login

# standalone server.js (port 3012) dengan Host apa pun
location: http://0.0.0.0:3012/login
```

Di browser (Playwright) pada `http://127.0.0.1:3010`, dengan sesi yang valid:

```
REQ  POST http://127.0.0.1:3010/api/auth/logout     ← request benar-benar terkirim
RES  303  loc=http://localhost:3010/login
FAILED .../api/auth/logout net::ERR_ABORTED          ← navigasi ke Location diblokir
CONSOLE error ... violates "form-action 'self'". The request has been blocked.
url now: http://127.0.0.1:3010/                       ← tetap di halaman lama
cookie after: 0                                       ← cookie session terhapus
DB: token sesi -> REVOKED at 2026-11-13T14:42:48Z     ← sesi benar-benar dicabut
```

Pada `http://localhost:3010` navigasi berhasil ke `/login` tanpa error.

**Dampak sebenarnya (koreksi penting):** pencabutan sesi di server **berhasil** — cookie dihapus dan baris `sessions` ditandai `revoked_at`. Yang rusak adalah **navigasi dan umpan balik ke pengguna**:

- Pengguna menekan Sign out, tidak terjadi apa-apa secara visual, dan tetap melihat halaman dashboard berisi data sensitif yang sudah dirender (DOM lama). Pada mesin bersama ini bisa disalahartikan sebagai "masih login", meski setiap request berikutnya akan ditolak/diarahkan ke `/login`.
- Bila CSP tidak memblokir (browser lain, atau CSP dilonggarkan), browser justru akan menavigasi ke `http://localhost:3010/login` — pada perangkat pengguna remote, `localhost` menunjuk ke mesin pengguna sendiri, bukan server. Halaman error atau, worst case, service lokal pengguna di port tersebut.
- Setiap deployment di balik reverse proxy/domain pasti terkena karena `req.url` mengabaikan `Host`.

Severity diturunkan dari High ke Medium setelah verifikasi database menunjukkan sesi tetap dicabut.

**Perbaikan (paling ringkas):** jangan bangun URL absolut dari `req.url`. Kirim `Location` relatif:

```ts
return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
```

Alternatif: `new URL("/login", process.env.NEXT_PUBLIC_APP_URL)`, tetapi redirect relatif menghilangkan seluruh kelas bug host ini tanpa konfigurasi tambahan.

---

### F-02 — Bypass rate-limit auth via `X-Forwarded-For` (High, `confirmed`)

**Lokasi:**
- `lib/http.ts:31-39` (`clientIp`)
- `app/(auth)/actions.ts:18-33` (`requestMeta` + `throttled`)

```ts
h.get("cf-connecting-ip") || h.get("x-real-ip") ||
h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
```

Tidak ada konfigurasi trust-proxy; aplikasi menerima header itu dari klien langsung.

**Bukti eksekusi (12 login gagal):**

```
XFF berbeda tiap request : invalid ×12   ← tidak pernah THROTTLED
tanpa XFF                : invalid ×10, THROTTLED, THROTTLED
```

**Dampak:** brute force/credential stuffing tanpa batas; setiap percobaan juga menulis audit `auth.login_failed`. Kunci rate-limit register memakai IP yang sama, sehingga pembuatan akun juga tidak terbatas secara efektif — masing-masing memberi **25 kredit signup** (`HAMSA_SIGNUP_CREDITS`) *(derived dari kode + bypass yang terbukti; farming akun tidak dieksekusi)*.

**Perbaikan:**
1. Tambahkan `HAMSA_TRUST_PROXY` (default `false`). Hormati `cf-connecting-ip`/`x-real-ip`/`x-forwarded-for` **hanya** jika aktif, dan ambil elemen paling kanan dari XFF (bukan paling kiri) agar tidak bisa dipalsukan klien.
2. Tambahkan throttle kedua per-akun: `login:${email}` dan `register:${email}`, karena IP saja selalu bisa diputar.
3. Pertimbangkan CAPTCHA/verifikasi email pada signup bila kredit diberikan otomatis.

---

### F-03 — Race condition cron watchlist (Medium, `confirmed`)

**Lokasi:** `lib/watchlist.ts:34-100`, `app/api/v1/cron/watchlist/route.ts`

Query memilih entri due tanpa lock/claim:

```sql
WHERE active = 1 AND (last_run_at IS NULL OR last_run_at + interval <= now())
```

`last_run_at` baru di-update **setelah** lookup selesai, sehingga N pemanggilan paralel memproses entri yang sama.

**Bukti eksekusi:** 1 entri due (`1.0.0.1`), 5 request cron paralel:

```
5× {"checked":1,...,"target":"1.0.0.1","status":"ok"}
lookups 1.0.0.1 : n=5, rentang 34 ms
ledger          : 5 debit, total -10 kredit
```

Pola yang sama ada di `runDueCameras` (tidak ada klaim baris), meski dampaknya lebih kecil (snapshot duplikat, bukan biaya).

**Perbaikan:** klaim baris secara atomik sebelum bekerja:

```sql
UPDATE watchlist SET last_run_at = now(), last_status = 'running'
WHERE id IN (
  SELECT id FROM watchlist
  WHERE active = 1 AND (last_run_at IS NULL OR last_run_at + interval_hours * interval '1 hour' <= now())
  ORDER BY COALESCE(last_run_at, timestamptz '1970-01-01')
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
RETURNING *;
```

Lalu proses hasil `RETURNING`. Ini menghilangkan kebutuhan lock tambahan dan tetap kompatibel dengan banyak worker.

---

### F-04 — Geofence "org-wide" milik analyst berlaku lintas user (Medium, `confirmed`)

**Lokasi:** `lib/track/geofence.ts:124`

```sql
SELECT * FROM geofences WHERE active = 1 AND (device_id IS NULL OR device_id = ?)
```

Fence dengan `device_id = NULL` dianggap organisasi, tetapi **siapa pun** (termasuk `analyst`) dapat membuatnya dan tidak ada filter kepemilikan/role saat evaluasi.

**Bukti eksekusi (langsung via library):**

```
admin device sees fences: [ { name: 'Audit Fence HQ', inside: false },
                            { name: 'Viewer fence XT', inside: true } ]
transitions: [ { name: 'Viewer fence XT', type: 'enter' } ]
```

Fence dibuat oleh user `analyst`, device milik `admin`. Notifikasi `geofence.enter` dikirim ke pemilik device.

**Dampak:** isolasi tenant bocor — fence milik user A memengaruhi device milik user B: event `geofence.enter/exit` tertulis di database dan notifikasi dikirim ke pemilik device, tanpa persetujuan/visibilitas dari pembuat device. A sendiri tidak dapat membaca event tersebut (daftar fence non-admin difilter `created_by`), jadi ini adalah **cross-tenant write/influence**, bukan kebocoran data langsung — tetapi tetap mencemari audit dan monitoring tenant lain. Test suite yang ada hanya menguji fence org-wide buatan **admin**, sehingga regresi ini tidak tertangkap.

**Perbaikan:** pilih salah satu model dan tegakkan konsisten:
- Jika org-wide memang fitur: batasi pembuatan `device_id = NULL` ke `admin`, dan dokumentasikan bahwa fence admin berlaku global.
- Jika multi-tenant: ubah predicate menjadi `(device_id = ? OR (device_id IS NULL AND created_by = ?))`, atau tambahkan tabel `organizations` + `org_id` pada device/fence dan filter berdasarkan itu.

---

### F-05 — SSRF via URL stream kamera (Medium, `confirmed`)

**Lokasi:** `lib/cctv/ffmpeg.ts:81-99` (`assertMediaInput`), `lib/cctv/service.ts:144+`

`assertMediaInput` menerima semua `http://`, `https://`, `rtsp://` tanpa memeriksa host. `createCamera` hanya memvalidasi protokol via `new URL()`.

**Bukti eksekusi:** kamera `http://127.0.0.1:3010/api/health` berhasil dienroll, lalu `Check` menjalankan ffmpeg terhadap URL tersebut; error ffmpeg tersimpan di `cameras.last_error` dan tampil di UI:

```
Error opening input: Invalid data found when processing input
Error opening input file http://127.0.0.1:3010/api/health.
```

**Dampak:** operator (atau akun analyst yang disusupi) dapat memindai jaringan internal, mengenai endpoint metadata cloud (`169.254.169.254`), atau service internal lain lewat ffmpeg. Respons mentah tidak dikembalikan ke UI, tetapi error/stderr memberi oracle keberadaan host/port dan fakta bahwa endpoint merespons (mis. "Invalid data found" vs "Connection refused").

**Perbaikan:** sebelum memanggil ffmpeg, resolve hostname dan tolak:
- `127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `fc00::/7`, `0.0.0.0`;
- host yang resolve ke alamat privat/link-local (termasuk setelah redirect);
- beri escape hatch eksplisit `HAMSA_CCTV_ALLOW_PRIVATE_NETWORKS=true` untuk pemakaian LAN yang disengaja, default `false`.

---

### F-06 — Inkonsistensi input media lokal (Low, `confirmed`)

`assertMediaInput` menerima path absolut (`/tmp/...`), tetapi `createCamera` memanggil `new URL(streamUrl)` yang melempar `Invalid URL` untuk path tanpa skema. Akibatnya pesan error membingungkan dan perilaku berbeda antara `assertMediaInput` dan alur simpan.

**Bukti:** enroll `/tmp/opencode/hamsa-audit/lab-cam.mp4` gagal; enroll `file:///tmp/...` berhasil.

**Perbaikan:** normalisasi di satu tempat — jika input diawali `/`, ubah ke `file://` sebelum `new URL()`, atau hapus dukungan path mentah dari `assertMediaInput` agar kontraknya tunggal.

---

### F-07 — Telegram `0 post` tanpa peringatan (Low, `likely`)

**Lokasi:** `lib/intel/telegram.ts:43-70`

Parser memecah HTML berdasarkan `tgme_widget_message_wrap`. Jika markup berubah atau halaman mengembalikan challenge/empty, hasilnya `count=0` tanpa warning, sementara kredit tetap dipotong.

**Bukti:** satu request dengan keyword `telegram` mengembalikan `count=0`; request berikutnya (fungsi langsung) mengembalikan 15, dan 20 tanpa keyword. Tidak tereproduksi konsisten → `likely` transient upstream, bukan bug parser permanen.

**Perbaikan:** jika `chunks.length === 0` atau `posts.length === 0 && keyword === ""`, tambahkan warning eksplisit ("channel preview returned no parseable posts") dan pertimbangkan refund otomatis.

---

### F-08 — Audit ganti password salah label (Low, `confirmed`)

`app/(console)/security-actions.ts:48-54` menulis `action: "auth.login"` dengan `meta.event = "password_changed"`. Setiap query audit yang menghitung login akan salah; deteksi anomali login jadi bising.

**Perbaikan:** gunakan `auth.password_change`.

---

### F-09 — Admin dapat menurunkan role sendiri (Low, `confirmed` dari kode)

`app/(console)/actions.ts:332-341` hanya memblokir `status === "suspended"` untuk diri sendiri. `role` bebas diubah, termasuk `admin → viewer`. Bila admin terakhir melakukannya, tidak ada lagi yang bisa mengelola provider/user.

**Perbaikan:** tolak perubahan role untuk `id === admin.id`, dan/atau hitung `SELECT count(*) FROM users WHERE role='admin' AND status='active'` sebelum demote/suspend.

---

### F-10 — Registrasi membocorkan email terdaftar (Low, `confirmed`)

`app/(auth)/actions.ts:73-75` mengembalikan `"An account with that email already exists."` secara langsung. Ini oracle enumerasi akun (tanpa rate-limit yang efektif, lihat F-02).

**Perbaikan:** selalu balas pesan generik ("If that address can be used, you'll receive a confirmation"), atau verifikasi email sebelum akun aktif.

---

### F-11 — Input invalid tetap dikenai biaya (Low, `confirmed`)

`lib/lookup.ts:80-81` melakukan `charge()` sebelum modul memvalidasi target. Contoh:
- IP `999.999.999.999` → lookup dibuat, biaya 2 kredit.
- Telegram target `"this channel has spaces"` → biaya 4 kredit, hasil kosong.

**Perbaikan:** validasi bentuk target per modul sebelum charge (IP parse, email syntax, channel regex, E.164), atau refund otomatis bila `status = invalid`.

---

### F-12 — Rate limiter in-process (Info, `confirmed` dari kode)

`lib/rate-limit.ts` memakai `Map` per proses. Komentar kode menyatakan ini disengaja untuk single-node. Jika deployment di-scale horizontal atau di belakang beberapa replika, limit menjadi N× lipat. Bukan bug pada topologi yang didokumentasikan, tetapi perlu dicatat dalam checklist produksi.

---

### F-13 — CSP `script-src 'unsafe-inline'` (Info, `confirmed`)

`next.config.ts:16,22`. Diperlukan karena Next menyuntikkan bootstrap inline; komentar kode mengakui ini. Mitigasi: nonce/hash pipeline bila ingin CSP ketat. Header lain sudah baik: `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS.

---

## 5. Yang diuji dan TIDAK ditemukan

| Kelas | Hasil |
|---|---|
| SQL injection | Tidak ada — seluruh query memakai placeholder `?`; interpolasi hanya identifier tetap (`USER_COLUMNS`) dan advisory lock numerik |
| XSS | Tidak ada `dangerouslySetInnerHTML`; output React di-escape; HTML t.me di-strip |
| IDOR | History/export/case/notifikasi/snapshot semuanya memfilter `user_id`; lintas user → `404` |
| Path traversal snapshot | `404`; `assertInsideStorage` + validasi ID |
| CSRF | Cookie `SameSite=Lax` + server action Next; tidak ada endpoint state-changing via GET |
| Secret at rest | Provider & password kamera terenkripsi `v1.<iv>.<tag>.<ct>` (AES-GCM); API key hanya hash SHA-256 |
| Kebocoran key di UI | Admin hanya menampilkan status, bukan nilai |
| Header keamanan | Lengkap (lihat F-13) |
| Dependency | `npm audit --omit=dev` → 0 vulnerabilities |
| Anon access | Semua halaman → `307 /login`; API → `401`/`403`; cron → `401` |

---

## 6. Rekomendasi prioritas

**Sebelum deploy (wajib):**
1. F-02 — tambah trust-proxy config + throttle per-email; batasi/verifikasi signup credit.
2. F-03 — klaim baris atomik (`FOR UPDATE SKIP LOCKED`) di cron watchlist; terapkan pola sama ke kamera.
3. F-01 — ganti redirect logout menjadi `Location: /login` relatif (perbaikan satu baris).

**Segera setelahnya:**
4. F-04 — tegakkan kepemilikan fence atau batasi org-wide ke admin.
5. F-05 — tolak host privat/loopback pada stream kamera (dengan escape hatch eksplisit).

**Backlog kualitas:**
6. F-06, F-07, F-08, F-09, F-10, F-11.
7. Tambah test regresi: logout via host non-localhost, XFF spoof, cron paralel, fence lintas user.

---

## 7. Catatan data & artefak

- `npm run seed` **tidak dijalankan**. Tidak ada `analyst@hamsa.local` / data sintetis di database.
- Isi database uji saat laporan ditulis: 2 users (admin + 1 analyst buatan audit), 25 lookups, 1 case + 1 evidence, 2 watchlist, 2 devices, 2 geofences, 3 geofence events, 2 cameras, 1 snapshot, 2 API keys, 28 ledger, 100 audit, 3 notifications.
- Artefak uji: `/tmp/opencode/hamsa-audit/` (token sesi, `lab-cam.mp4`, screenshot, log server, skrip Playwright `e2e-*.mjs`, `xff-test.mjs`, `ratelimit-nospoof.mjs`).
- Server uji (3010, 3011, 3012) sudah dihentikan setelah audit selesai. Untuk mengulang: `next start -p 3010`, `HAMSA_CCTV_ALLOW_LOCAL_MEDIA=true next start -p 3011`, `node .next/standalone/server.js` (port 3012).
- Kredensial lokal ada di `/root/Hamsa/.env` dan `/tmp/opencode/hamsa-admin.txt` — jangan commit `.env` (sudah di `.gitignore`).

## 8. Keterbatasan audit

- Provider berbayar (Numverify, HIBP, ipinfo) tidak diuji dengan key asli; jalur `provider` di kode belum diverifikasi end-to-end.
- Tidak ada kamera RTSP fisik; CCTV diuji dengan file lokal + ffmpeg, sehingga jalur auth/timeout RTSP hanya diverifikasi lewat unit test.
- Pengujian browser hanya Chromium; Safari/Firefox tidak diuji (relevan untuk perilaku CSP `form-action`).
- Tidak ada pengujian beban/DoS.
- Temuan F-09 bersifat statis (tidak dieksekusi) karena akan mengunci akses admin pada instance uji.
