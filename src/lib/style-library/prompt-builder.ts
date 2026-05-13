// ============================================================
// AI 短劇平台 — Kling Prompt 合成核心函數
// ============================================================
// 對應文檔: style-library-design-v3.md (第四部分)
// 重要: 兩個函數都支援 element_list 注入（角色綁定）
// ============================================================

import type {
  VisualStyle,
  LightingPreset,
  KlingPromptResult,
  MultiShotResult,
} from './types'
import { visualStyles } from './visual-styles'
import { lightingPresets } from './lighting-presets'

// ============================================================
// Helper: 查詢
// ============================================================

export function getStyle(styleId: string): VisualStyle {
  const style = visualStyles.find((s) => s.id === styleId);
  if (!style) throw new Error(`Visual style not found: ${styleId}`);
  return style;
}

export function getLighting(lightingId: string): LightingPreset {
  const lighting = lightingPresets.find((l) => l.id === lightingId);
  if (!lighting) throw new Error(`Lighting preset not found: ${lightingId}`);
  return lighting;
}

// ============================================================
// 單鏡頭 Prompt 合成
// ============================================================

export interface BuildKlingPromptOptions {
  /** 用戶輸入的劇情/場景描述（用 <<<element_N>>> 引用角色） */
  userContent: string;
  /** 視覺風格 ID（必選） */
  styleId: string;
  /** 光影預設 ID（可選） */
  lightingId?: string;
  /** 題材模板（可選，會 prepend 到 userContent 前面） */
  genreTemplate?: string;
}

/**
 * 組合單鏡頭 Kling Prompt
 *
 * Prompt 結構順序（Kling 3.0 官方建議）：
 *   Scene → Characters → Action → Camera → Style/Lighting
 *
 * 即：styleAnchor → userContent → lightingOverride → visualModifiers
 */
export function buildKlingPrompt(opts: BuildKlingPromptOptions): KlingPromptResult {
  const style = getStyle(opts.styleId);
  const lighting = opts.lightingId ? getLighting(opts.lightingId) : null;

  // 用戶內容 = (題材模板 + 用戶輸入)
  const content = [opts.genreTemplate, opts.userContent].filter(Boolean).join(' ');

  // 合成順序: 風格錨點 → 用戶內容 → 光影 → 視覺修飾
  const prompt = [
    style.styleAnchor,
    content,
    lighting?.lightingOverride,
    style.visualModifiers,
  ]
    .filter(Boolean)
    .join('. ');

  // Negative prompt 合併: 風格 negative + 光影 additionalNegative
  const negativePrompt = [style.negativePrompt, lighting?.additionalNegative]
    .filter(Boolean)
    .join(', ');

  return { prompt, negativePrompt };
}

// ============================================================
// 多鏡頭短劇 Prompt 合成（給 Kling-Omni-Video MultiShot 用）
// ============================================================

export interface ShotInput {
  /** 鏡頭描述 */
  description: string;
  /** 鏡頭時長（秒） */
  duration: number;
}

export interface BuildMultiShotOptions {
  /** 多個鏡頭 */
  shots: ShotInput[];
  /** 視覺風格 ID（必選） */
  styleId: string;
  /** 光影預設 ID（可選） */
  lightingId?: string;
  /** 是否在 negativePrompt 加入「短劇通用穩定詞」 */
  includeStabilityNegatives?: boolean;
}

/**
 * 組合多鏡頭 Kling Prompt
 *
 * 關鍵點：每個 shot 都要重複完整風格描述（"Style Bible"），
 * 否則 Kling 會在後續鏡頭中發生 style drift（風格漂移）。
 */
export function buildShortDramaShots(opts: BuildMultiShotOptions): MultiShotResult {
  const style = getStyle(opts.styleId);
  const lighting = opts.lightingId ? getLighting(opts.lightingId) : null;

  // Style Bible: 每個 shot 結尾都會貼這段
  const styleBible = `${style.styleAnchor}. ${style.visualModifiers}`;

  const shots = opts.shots.map((shot, idx) => ({
    index: idx,
    prompt: [
      `Shot ${idx + 1}:`,
      shot.description,
      lighting?.lightingOverride,
      styleBible, // ⚠️ 關鍵：每個 shot 都重貼
    ]
      .filter(Boolean)
      .join('. '),
    duration: shot.duration,
  }));

  const negativeParts = [style.negativePrompt, lighting?.additionalNegative];

  if (opts.includeStabilityNegatives !== false) {
    negativeParts.push(
      'no style drift, no text, no watermark, no distorted hands, no sliding feet, stabilized framing'
    );
  }

  return {
    shots,
    negativePrompt: negativeParts.filter(Boolean).join(', '),
  };
}

// ============================================================
// 完整 Kling API Request 組裝（騰訊 VOD AIGC 路徑）
// ============================================================

export interface BuildVodAigcRequestOptions extends BuildMultiShotOptions {
  /** 騰訊 VOD 的 SubAppId */
  subAppId: number;
  /** 已註冊的主體 ElementId 列表 */
  elementIds?: string[];
  /** 畫面比例 */
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3';
  /** 解析度 */
  resolution?: '540P' | '720P' | '1080P' | '4K';
  /** 模式 */
  mode?: 'std' | 'pro';
}

/**
 * 組裝騰訊 VOD AIGC 的 CreateAigcVideoTask Request
 * (對應 路徑 A: vod.tencentcloudapi.com)
 */
export function buildVodAigcRequest(opts: BuildVodAigcRequestOptions) {
  const style = getStyle(opts.styleId);
  const multiShot = buildShortDramaShots(opts);
  const totalDuration = opts.shots.reduce((sum, s) => sum + s.duration, 0);

  // 主體列表（雙層 JSON 編碼進 ExtInfo）
  let extInfo: string | undefined;
  if (opts.elementIds && opts.elementIds.length > 0) {
    const klingParams = JSON.stringify({
      element_list: opts.elementIds.map((id) => ({ element_id: id })),
      multi_shot: 'customize',
      short_type: 'customize',
    });
    extInfo = JSON.stringify({ AdditionalParameters: klingParams });
  }

  return {
    SubAppId: opts.subAppId,
    ModelName: 'Kling',
    ModelVersion: style.recommendedKlingVersion,
    Prompt: multiShot.shots.map((s) => s.prompt).join('\n\n'),
    NegativePrompt: multiShot.negativePrompt,
    EnhancePrompt: 'Disabled', // ⚠️ 關鍵：關掉騰訊 prompt 改寫
    ...(extInfo && { ExtInfo: extInfo }),
    OutputConfig: {
      StorageMode: 'Permanent',
      Duration: totalDuration,
      AspectRatio: opts.aspectRatio ?? '9:16',
      Resolution: opts.resolution ?? '1080P',
      AudioGeneration: 'Disabled',
      InputComplianceCheck: 'Enabled',
      OutputComplianceCheck: 'Enabled',
    },
  };
}

// ============================================================
// 完整 Kling API Request 組裝（VCLM 路徑）
// ============================================================

export interface BuildVclmRequestOptions extends BuildMultiShotOptions {
  /** 已註冊的主體 ElementId 列表 */
  elementIds?: string[];
  /** 畫面比例 */
  aspectRatio?: '9:16' | '16:9' | '1:1';
  /** 模式 */
  mode?: 'std' | 'pro';
}

/**
 * 組裝騰訊 VCLM 的 SubmitVideoEditKlingJob Request
 * (對應 路徑 B: vclm.tencentcloudapi.com)
 *
 * VCLM 路徑優勢：ElementList / MultiShot / MultiPrompt 都是一級字段，
 * 不用像 VOD 那樣做雙層 JSON 編碼進 ExtInfo。
 */
export function buildVclmRequest(opts: BuildVclmRequestOptions) {
  const style = getStyle(opts.styleId);
  const multiShot = buildShortDramaShots(opts);
  const totalDuration = opts.shots.reduce((sum, s) => sum + s.duration, 0);

  // VCLM 的 Duration 只支援 3-10 整數秒
  const clampedDuration = Math.max(3, Math.min(10, Math.round(totalDuration)));

  // VCLM 模型名稱對映（'3.0' / '3.0-Omni' → 'kling-v3-omni'）
  const vclmModel =
    style.recommendedKlingVersion === '3.0-Omni'
      ? 'kling-v3-omni'
      : 'kling-video-o1';

  return {
    Model: vclmModel,
    AspectRatio: opts.aspectRatio ?? '9:16',
    Duration: clampedDuration,
    Mode: opts.mode ?? 'pro',
    MultiShot: opts.shots.length > 1,
    ShotType: opts.shots.length > 1 ? 'customize' : undefined,
    MultiPrompt:
      opts.shots.length > 1
        ? multiShot.shots.map((s) => ({
            index: s.index,
            prompt: s.prompt,
            duration: s.duration,
          }))
        : undefined,
    Prompt: opts.shots.length === 1 ? multiShot.shots[0].prompt : undefined,
    ElementList: opts.elementIds?.map((id) => ({ element_id: id })),
  };
}
