/**
 * MOG2 background subtractor (Zivkovic-style Gaussian mixture), pure TypeScript.
 *
 * The production pipeline feeds it grayscale frames decoded by ffmpeg
 * (`rawvideo`, `-pix_fmt gray`), so no OpenCV binding is required. The model is
 * intentionally close to OpenCV's `createBackgroundSubtractorMOG2`:
 *
 *  - `components` Gaussians per pixel (default 3)
 *  - exponential weight/mean/variance updates with learning rate `alpha`
 *  - a pixel matches a component when `(x-μ)² <= varThreshold · σ²`
 *  - unmatched pixels replace the weakest component and are foreground
 *  - a matched component is foreground when it falls outside the components
 *    that make up `backgroundRatio` of the pixel's weight
 *
 * A 3×3 erosion removes salt-and-pepper noise before counting, and the first
 * `warmup` frames only train the model. The threshold on the resulting ratio is
 * configured per camera (`cameras.motion_threshold`) or globally
 * (`HAMSA_MOTION_THRESHOLD`).
 */

export interface Mog2Options {
  components?: number;
  alpha?: number;
  varThreshold?: number;
  minVar?: number;
  initVar?: number;
  backgroundRatio?: number;
  warmup?: number;
  erode?: boolean;
}

export interface MotionResult {
  frames: number;
  ready: boolean;
  changedPixels: number;
  ratio: number;
  foreground: Uint8Array;
}

const DEFAULTS = {
  components: 3,
  alpha: 0.02,
  varThreshold: 4,
  minVar: 4,
  initVar: 225,
  backgroundRatio: 0.9,
  warmup: 5,
  erode: true,
};

export class Mog2 {
  private readonly width: number;
  private readonly height: number;
  private readonly components: number;
  private readonly alpha: number;
  private readonly varThreshold: number;
  private readonly minVar: number;
  private readonly initVar: number;
  private readonly backgroundRatio: number;
  private readonly warmup: number;
  private readonly erodeEnabled: boolean;

  private readonly mean: Float32Array;
  private readonly variance: Float32Array;
  private readonly weight: Float32Array;
  private readonly mask: Uint8Array;
  private readonly eroded: Uint8Array;
  private frameCount = 0;

  constructor(width: number, height: number, options: Mog2Options = {}) {
    if (width <= 0 || height <= 0) throw new Error("Frame dimensions must be positive");
    this.width = width;
    this.height = height;
    this.components = options.components ?? DEFAULTS.components;
    this.alpha = options.alpha ?? DEFAULTS.alpha;
    this.varThreshold = options.varThreshold ?? DEFAULTS.varThreshold;
    this.minVar = options.minVar ?? DEFAULTS.minVar;
    this.initVar = options.initVar ?? DEFAULTS.initVar;
    this.backgroundRatio = options.backgroundRatio ?? DEFAULTS.backgroundRatio;
    this.warmup = options.warmup ?? DEFAULTS.warmup;
    this.erodeEnabled = options.erode ?? DEFAULTS.erode;

    const size = width * height * this.components;
    this.mean = new Float32Array(size);
    this.variance = new Float32Array(size);
    this.weight = new Float32Array(size);
    this.mask = new Uint8Array(width * height);
    this.eroded = new Uint8Array(width * height);
  }

  reset(): void {
    this.mean.fill(0);
    this.variance.fill(0);
    this.weight.fill(0);
    this.mask.fill(0);
    this.eroded.fill(0);
    this.frameCount = 0;
  }

  apply(frame: Uint8Array): MotionResult {
    const pixels = this.width * this.height;
    if (frame.length !== pixels) {
      throw new Error(`Expected ${pixels} bytes, received ${frame.length}`);
    }

    if (this.frameCount === 0) {
      this.initialise(frame);
      this.frameCount = 1;
      return { frames: 1, ready: false, changedPixels: 0, ratio: 0, foreground: this.mask };
    }

    const k = this.components;
    for (let p = 0; p < pixels; p += 1) {
      const value = frame[p];
      const base = p * k;

      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let c = 0; c < k; c += 1) {
        const index = base + c;
        if (this.weight[index] <= 0) continue;
        const delta = value - this.mean[index];
        const distance = delta * delta;
        if (distance <= this.varThreshold * this.variance[index] && distance < bestDistance) {
          best = c;
          bestDistance = distance;
        }
      }

      if (best >= 0) {
        const index = base + best;
        const oldMean = this.mean[index];
        const delta = value - oldMean;

        this.weight[index] += this.alpha * (1 - this.weight[index]);
        this.mean[index] = oldMean + this.alpha * delta;
        this.variance[index] = Math.max(
          this.minVar,
          this.variance[index] + this.alpha * (delta * delta - this.variance[index]),
        );

        this.mask[p] = this.isBackgroundComponent(base, best) ? 0 : 1;
      } else {
        let weakest = 0;
        for (let c = 1; c < k; c += 1) {
          if (this.weight[base + c] < this.weight[base + weakest]) weakest = c;
        }
        const index = base + weakest;
        this.weight[index] = this.alpha;
        this.mean[index] = value;
        this.variance[index] = this.initVar;
        this.mask[p] = 1;
      }

      // Keep the mixture normalised; the ratio is only meaningful if weights sum to 1.
      let total = 0;
      for (let c = 0; c < k; c += 1) total += this.weight[base + c];
      if (total > 0) {
        for (let c = 0; c < k; c += 1) this.weight[base + c] /= total;
      }
    }

    this.frameCount += 1;

    if (this.frameCount <= this.warmup) {
      this.mask.fill(0);
      return { frames: this.frameCount, ready: false, changedPixels: 0, ratio: 0, foreground: this.mask };
    }

    const changedPixels = this.erodeEnabled ? this.countAfterErosion() : this.count(this.mask);
    return {
      frames: this.frameCount,
      ready: true,
      changedPixels,
      ratio: changedPixels / pixels,
      foreground: this.erodeEnabled ? this.eroded : this.mask,
    };
  }

  private initialise(frame: Uint8Array): void {
    const k = this.components;
    for (let p = 0; p < frame.length; p += 1) {
      const base = p * k;
      this.mean[base] = frame[p];
      this.variance[base] = this.initVar;
      this.weight[base] = 1;
      for (let c = 1; c < k; c += 1) {
        this.mean[base + c] = frame[p];
        this.variance[base + c] = this.initVar;
        this.weight[base + c] = 0;
      }
    }
    this.mask.fill(0);
  }

  /** True when `best` belongs to the components covering `backgroundRatio` of the weight. */
  private isBackgroundComponent(base: number, best: number): boolean {
    const k = this.components;
    const order: number[] = [];
    for (let c = 0; c < k; c += 1) order.push(c);
    order.sort((a, b) => this.weight[base + b] - this.weight[base + a]);

    let cumulative = 0;
    let cutoff = k;
    for (let i = 0; i < order.length; i += 1) {
      cumulative += this.weight[base + order[i]];
      if (cumulative >= this.backgroundRatio) {
        cutoff = i + 1;
        break;
      }
    }

    return order.slice(0, cutoff).includes(best);
  }

  private countAfterErosion(): number {
    const { width, height } = this;
    const source = this.mask;
    const target = this.eroded;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = 1;
        for (let dy = -1; dy <= 1 && value === 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            value = 0;
            break;
          }
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width || source[ny * width + nx] === 0) {
              value = 0;
              break;
            }
          }
        }
        target[y * width + x] = value;
      }
    }

    return this.count(target);
  }

  private count(mask: Uint8Array): number {
    let total = 0;
    for (let i = 0; i < mask.length; i += 1) total += mask[i];
    return total;
  }
}
