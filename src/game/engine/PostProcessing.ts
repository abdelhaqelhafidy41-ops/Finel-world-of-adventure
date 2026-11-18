import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type {
  AntiAliasingMode,
  PostProcessingTier,
} from './GraphicsQualityManager';

/**
 * Configurable GPU post-processing pipeline supporting:
 * - Direct bypass (`renderer.render`) when postProcessing === 'off' and antiAliasing !== 'fxaa'
 * - Half/quarter-res HDR UnrealBloomPass
 * - OutputPass (ACESFilmic tone mapping + SRGB conversion)
 * - Optional FXAA pass or MSAA render target when composer is active
 */
export class PostProcessingPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  private composer: EffectComposer | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private fxaaPass: ShaderPass | null = null;

  private postTier: PostProcessingTier = 'high';
  private aaMode: AntiAliasingMode = 'fxaa';
  private width: number;
  private height: number;
  private pixelRatio = 1;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    pixelRatio = 1,
    postTier: PostProcessingTier = 'high',
    aaMode: AntiAliasingMode = 'fxaa',
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.postTier = postTier;
    this.aaMode = aaMode;

    // Only allocate HDR offscreen FBOs & bloom mip chains if post-processing or FXAA is actually enabled
    if (!this.isBypassed()) {
      this.initComposer();
    }
  }

  private initComposer(): void {
    if (this.composer) return;
    this.renderTarget = this.createRenderTarget(
      this.width,
      this.height,
      this.pixelRatio,
      this.aaMode,
    );
    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    const halfW = Math.max(1, Math.floor(this.width * 0.5));
    const halfH = Math.max(1, Math.floor(this.height * 0.5));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(halfW, halfH),
      0.22,
      0.42,
      0.9,
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);

    this.syncPassStates();
    this.updateBloomResolution();
    this.updateFxaaResolution();
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.fxaaPass?.dispose();
    this.composer.dispose();
    this.renderTarget?.dispose();
    this.composer = null;
    this.renderTarget = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.fxaaPass = null;
  }

  private createRenderTarget(
    width: number,
    height: number,
    pixelRatio: number,
    aaMode: AntiAliasingMode,
  ): THREE.WebGLRenderTarget {
    const rtW = Math.max(1, Math.floor(width * pixelRatio));
    const rtH = Math.max(1, Math.floor(height * pixelRatio));
    const samples = aaMode === 'msaa' ? 4 : 0;
    return new THREE.WebGLRenderTarget(rtW, rtH, {
      type: THREE.HalfFloatType,
      samples,
    });
  }

  public isBypassed(): boolean {
    return this.postTier === 'off' && this.aaMode !== 'fxaa';
  }

  public hasAllocatedTargets(): boolean {
    return this.composer !== null;
  }

  public setMode(postTier: PostProcessingTier, aaMode: AntiAliasingMode): void {
    const msaaChanged = (this.aaMode === 'msaa') !== (aaMode === 'msaa');
    this.postTier = postTier;
    this.aaMode = aaMode;

    if (this.isBypassed()) {
      // Release GPU offscreen render targets immediately to save VRAM on low-end Android
      this.disposeComposer();
      return;
    }

    if (!this.composer) {
      this.initComposer();
      return;
    }

    if (msaaChanged) {
      const nextRt = this.createRenderTarget(
        this.width,
        this.height,
        this.pixelRatio,
        aaMode,
      );
      this.composer.reset(nextRt);
      this.renderTarget?.dispose();
      this.renderTarget = nextRt;
    }

    this.syncPassStates();
    this.updateBloomResolution();
    this.updateFxaaResolution();
  }

  private syncPassStates(): void {
    if (this.bloomPass) this.bloomPass.enabled = this.postTier !== 'off';
    if (this.fxaaPass) this.fxaaPass.enabled = this.aaMode === 'fxaa';
    if (this.outputPass) this.outputPass.enabled = true;
  }

  private updateBloomResolution(): void {
    if (!this.bloomPass) return;
    const factor = this.postTier === 'low' ? 0.25 : 0.5;
    this.bloomPass.resolution.set(
      Math.max(1, Math.floor(this.width * factor)),
      Math.max(1, Math.floor(this.height * factor)),
    );
  }

  private updateFxaaResolution(): void {
    if (!this.fxaaPass) return;
    const invW = 1 / Math.max(1, this.width * this.pixelRatio);
    const invH = 1 / Math.max(1, this.height * this.pixelRatio);
    const resUniform = this.fxaaPass.material?.uniforms?.['resolution'];
    if (resUniform?.value) {
      resUniform.value.set(invW, invH);
    }
  }

  public update(nightFactor: number, lightningFlash: number): void {
    if (!this.bloomPass || !this.bloomPass.enabled) return;
    const tierScale =
      this.postTier === 'low' ? 0.72 : this.postTier === 'medium' ? 0.88 : 1.0;
    this.bloomPass.strength =
      (0.2 + nightFactor * 0.12 + lightningFlash * 0.24) * tierScale;
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.92, 0.82, nightFactor);
  }

  public render(): void {
    if (this.isBypassed() || !this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  public setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.updateBloomResolution();
    this.updateFxaaResolution();
  }

  public dispose(): void {
    this.disposeComposer();
  }
}
