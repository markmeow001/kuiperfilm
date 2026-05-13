-- ============================================================
-- AI 短劇平台 — 視覺風格庫資料庫 Schema
-- 對應文檔: style-library-design-v3.md
-- 目標: PostgreSQL 14+（或 MySQL 8.0+，需把 JSONB 改成 JSON）
-- ============================================================

-- ------------------------------------------------------------
-- Table 1: visual_styles (Layer 1 — 視覺風格)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visual_styles (
  id                          VARCHAR(64) PRIMARY KEY,
  name_zh                     VARCHAR(64) NOT NULL,
  name_en                     VARCHAR(64) NOT NULL,
  category                    VARCHAR(32) NOT NULL,  -- A/B/C/D/E/F/G
  category_name_zh            VARCHAR(32) NOT NULL,
  thumbnail_url               TEXT,                  -- 範例圖（給 UI 卡片顯示）
  style_anchor                TEXT NOT NULL,         -- 注入 prompt 開頭的英文風格詞
  visual_modifiers            TEXT NOT NULL,         -- 注入 prompt 結尾的視覺修飾
  negative_prompt             TEXT NOT NULL,         -- 完整覆蓋預設 negative
  reference_artists           JSONB,                 -- 參考藝術家/作品
  best_for_genres             JSONB,                 -- 適合題材
  recommended_kling_version   VARCHAR(16) DEFAULT '3.0-Omni',
  tags                        JSONB,
  display_order               INT DEFAULT 0,
  is_active                   BOOLEAN DEFAULT TRUE,
  created_at                  TIMESTAMP DEFAULT NOW(),
  updated_at                  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_visual_styles_category ON visual_styles(category, display_order);
CREATE INDEX idx_visual_styles_active ON visual_styles(is_active);

-- ------------------------------------------------------------
-- Table 2: lighting_presets (Layer 2 — 光影預設)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lighting_presets (
  id                  VARCHAR(64) PRIMARY KEY,
  name_zh             VARCHAR(64) NOT NULL,
  name_en             VARCHAR(64) NOT NULL,
  thumbnail_url       TEXT,
  lighting_override   TEXT NOT NULL,
  additional_negative TEXT,
  best_for_moods      JSONB,
  tags                JSONB,
  display_order       INT DEFAULT 0,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Table 3: style_lighting_recommendations (推薦組合)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS style_lighting_recommendations (
  style_id          VARCHAR(64) REFERENCES visual_styles(id) ON DELETE CASCADE,
  lighting_id       VARCHAR(64) REFERENCES lighting_presets(id) ON DELETE CASCADE,
  recommended_genre VARCHAR(64),
  popularity_score  INT DEFAULT 0,
  PRIMARY KEY (style_id, lighting_id, recommended_genre)
);

-- ------------------------------------------------------------
-- Table 4: style_elements (Kling 主體庫)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS style_elements (
  element_id          VARCHAR(64) PRIMARY KEY,             -- Kling 回傳的 ElementId
  style_id            VARCHAR(64) REFERENCES visual_styles(id),
  character_type      VARCHAR(32),                          -- male_lead / female_lead / antagonist / supporting
  age_range           VARCHAR(32),                          -- teen / young_adult / mature / elder
  description         TEXT,
  frontal_image_url   TEXT NOT NULL,
  reference_image_urls JSONB,                               -- 多角度參考圖
  voice_id            VARCHAR(64),                          -- 綁定的音色（VCLM 才有）
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_style_elements_style ON style_elements(style_id, character_type);
