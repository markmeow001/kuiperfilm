// ============================================================
// AI 短劇平台 — 視覺風格庫 Type 定義
// ============================================================

/** Layer 1: 視覺風格 */
export interface VisualStyle {
  /** 唯一識別，snake_case 英文 */
  id: string;
  /** 中文名（UI 顯示用） */
  nameZh: string;
  /** 英文名 */
  nameEn: string;
  /** 分類 ID：A=寫實影視, B=日系動漫, C=美漫西方插畫, D=韓系, E=國風, F=CG/3D, G=復古概念 */
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  /** 分類名稱（中文） */
  categoryNameZh: string;
  /** 範例圖 URL（給 UI 卡片顯示，建議 1:1 方形或 4:5） */
  thumbnailUrl: string | null;
  /** 注入 prompt 開頭的英文風格錨點（核心） */
  styleAnchor: string;
  /** 注入 prompt 結尾的視覺修飾詞 */
  visualModifiers: string;
  /** 完整覆蓋預設 negative prompt */
  negativePrompt: string;
  /** 推薦參考的藝術家/作品（給用戶看 + 註冊主體圖時參考） */
  referenceArtists: string[];
  /** 適合搭配的劇情題材 */
  bestForGenres: string[];
  /** 推薦的 Kling 版本 */
  recommendedKlingVersion: '3.0' | '3.0-Omni';
  /** 標籤 */
  tags: string[];
  /** UI 顯示順序 */
  displayOrder: number;
  /** 是否啟用 */
  isActive: boolean;
}

/** Layer 2: 光影預設 */
export interface LightingPreset {
  id: string;
  nameZh: string;
  nameEn: string;
  thumbnailUrl: string | null;
  /** 注入到 visualModifiers 之前的光影描述 */
  lightingOverride: string;
  /** 額外要加進 negativePrompt 的內容 */
  additionalNegative: string;
  /** 適合的情緒/氛圍 */
  bestForMoods: string[];
  tags: string[];
  displayOrder: number;
  isActive: boolean;
}

/** 推薦組合 */
export interface StyleLightingRecommendation {
  styleId: string;
  lightingId: string;
  recommendedGenre: string;
  popularityScore: number;
}

/** Kling 主體庫（後續註冊主體後填入） */
export interface StyleElement {
  /** Kling 回傳的 ElementId */
  elementId: string;
  styleId: string;
  characterType: 'male_lead' | 'female_lead' | 'antagonist' | 'supporting';
  ageRange: 'teen' | 'young_adult' | 'mature' | 'elder';
  description: string;
  frontalImageUrl: string;
  referenceImageUrls: string[];
  voiceId: string | null;
}

/** Prompt 合成結果 */
export interface KlingPromptResult {
  prompt: string;
  negativePrompt: string;
}

/** 多鏡頭合成結果 */
export interface MultiShotResult {
  shots: Array<{
    index: number;
    prompt: string;
    duration: number;
  }>;
  negativePrompt: string;
}
