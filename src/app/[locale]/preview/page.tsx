/* eslint-disable @typescript-eslint/ban-ts-comment, no-restricted-imports */
// @ts-nocheck
// Standalone visual workflow reference retained for design comparison.
// Rendered at /[locale]/preview without disturbing the real workspace.
// Data is hard-coded; no API calls. The two file-wide eslint-disables
// above are intentional: this is a frozen mockup port, not application
// code, so the icon-system rule and ts-nocheck ban don't apply.
'use client'

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { ProductionBrand } from "@/components/v2/ProductionBrand";
import {
  Film,
  PenLine,
  Users,
  Layers,
  Mic,
  Play,
  ArrowRight,
  Check,
  Sparkles,
  Wand2,
  Upload,
  ImageIcon,
  Video,
  Volume2,
  ChevronRight,
  Plus,
  Eye,
  Download,
  Pause,
  Settings2,
  Star,
} from "lucide-react";

const STEPS = [
  { id: "home", num: "00", label: "首頁", subtitle: "Mode", icon: Film },
  { id: "script", num: "01", label: "劇本", subtitle: "Script", icon: PenLine },
  // 2026-05-21 — sync with V2 sidebar (cb3b398: 主體 → 劇本拆解).
  // "主體" was image-generation jargon; "劇本拆解" matches film-
  // production vocabulary actual users mental-model with.
  { id: "subjects", num: "02", label: "劇本拆解", subtitle: "Breakdown", icon: Users },
  { id: "storyboard", num: "03", label: "分鏡", subtitle: "Storyboard", icon: Layers },
  { id: "voice", num: "04", label: "配音", subtitle: "Voice", icon: Mic },
  { id: "final", num: "05", label: "成片", subtitle: "Final Cut", icon: Play },
];

const previewStyle = `
  .grain {
    background-image:
      radial-gradient(rgba(85,175,192,0.05) 1px, transparent 1px);
    background-size: 3px 3px;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .shimmer {
    background: linear-gradient(90deg,
      rgba(85,175,192,0) 0%,
      rgba(85,175,192,0.15) 50%,
      rgba(85,175,192,0) 100%);
    background-size: 200% 100%;
    animation: shimmer 2.5s infinite;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeInUp 0.5s ease forwards; }

  @keyframes pulse-cyan {
    0%, 100% { box-shadow: 0 0 0 0 rgba(85,175,192,0.36); }
    50% { box-shadow: 0 0 0 8px rgba(85,175,192,0); }
  }
  .pulse-cyan { animation: pulse-cyan 2s infinite; }

  /* Mock generated image gradient backgrounds */
  .bg-img-1 { background: linear-gradient(135deg, #102A38 0%, #29556B 40%, #0E1820 100%); }
  .bg-img-2 { background: linear-gradient(135deg, #121D38 0%, #254D70 50%, #4B6982 100%); }
  .bg-img-3 { background: linear-gradient(135deg, #171F36 0%, #315670 50%, #14232E 100%); }
  .bg-img-4 { background: linear-gradient(135deg, #0E3F45 0%, #1E4462 50%, #17232D 100%); }
  .bg-img-5 { background: linear-gradient(135deg, #112734 0%, #2C5264 60%, #5592A4 100%); }
  .bg-img-6 { background: linear-gradient(135deg, #0D141B 0%, #263642 50%, #3E73B9 100%); }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: rgba(0,0,0,0); }
  ::-webkit-scrollbar-thumb { background: rgba(85,175,192,0.25); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(85,175,192,0.45); }

  .kuiper-design-preview button,
  .kuiper-design-preview input,
  .kuiper-design-preview textarea {
    touch-action: manipulation;
  }

  @media (max-width: 767px) {
    .kuiper-design-preview button,
    .kuiper-design-preview input {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .kuiper-design-preview *,
    .kuiper-design-preview *::before,
    .kuiper-design-preview *::after {
      scroll-behavior: auto !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
`;

// ─────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────
function Sidebar({ current, setCurrent, locale }) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-[#263642] bg-[#0D141B] md:h-screen md:w-64 md:border-b-0 md:border-r">
      {/* Logo */}
      <div className="flex items-center justify-between border-b border-[#263642] px-4 py-4 md:block md:px-7 md:pb-8 md:pt-8">
        <div className="min-w-0">
          <ProductionBrand locale={locale} href={`/${locale}/v2`} tone="dark" />
          <div
            role="note"
            className="mt-3 rounded-md border border-[#31505D] bg-[#13262F] px-2.5 py-2 font-sans text-[9px] tracking-[0.16em] text-[#79C7D4]"
          >
            <span className="block">DESIGN REFERENCE</span>
            <span className="mt-1 block font-body text-[10px] normal-case tracking-normal text-[#A7B3BC]">
              {locale === "en" ? "Mock data · Not the live workspace" : "設計參考 · 非正式資料"}
            </span>
          </div>
        </div>
        <div className="font-mono text-[10px] tracking-[0.16em] text-[#55AFC0] md:hidden">
          {STEPS.find((step) => step.id === current)?.num} / {STEPS.length - 1}
        </div>
      </div>

      {/* Steps */}
      <nav aria-label="製作流程" className="grid grid-cols-3 gap-2 px-3 py-3 sm:grid-cols-6 md:block md:flex-1 md:space-y-1 md:px-4 md:py-6">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const active = step.id === current;
          const completed = STEPS.findIndex((s) => s.id === current) > STEPS.findIndex((s) => s.id === step.id);
          return (
            <button
              key={step.id}
              onClick={() => setCurrent(step.id)}
              aria-current={active ? "step" : undefined}
              className={`group flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-2 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] md:justify-start md:gap-3 md:px-3 md:py-2.5 ${
                active
                  ? "border-[#55AFC0]/40 bg-[#55AFC0]/10"
                  : "border-transparent hover:bg-[#17232D]/80"
              }`}
            >
              <div
                className={`hidden w-6 font-mono text-[10px] tracking-wider md:block ${
                  active ? "text-[#6FC7D5]" : completed ? "text-[#79C7D4]" : "text-[#7F9099]"
                }`}
              >
                {step.num}
              </div>
              <Icon
                className={`w-4 h-4 ${
                  active ? "text-[#6FC7D5]" : completed ? "text-[#79C7D4]" : "text-[#8796A1]"
                }`}
                strokeWidth={1.5}
              />
              <div className="min-w-0 text-center md:flex-1 md:text-left">
                <div
                  className={`font-serif-cn text-sm leading-none ${
                    active ? "text-[#DFF8FC]" : "text-[#C6D1D6]"
                  }`}
                >
                  {step.label}
                </div>
                <div className="mt-0.5 hidden font-fraunces text-[10px] italic text-[#7F9099] md:block">
                  {step.subtitle}
                </div>
              </div>
              {completed && <Check className="hidden h-3 w-3 text-[#79C7D4] md:block" strokeWidth={2} />}
            </button>
          );
        })}
      </nav>

      {/* User block */}
      <div className="hidden border-t border-[#263642] px-5 py-5 md:block">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#55AFC0] to-[#3E73B9] font-display text-sm text-[#F2F6F7]">
            紫
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-body text-sm text-[#DCE5E8] truncate">紫月創作者</div>
            <div className="mt-0.5 font-mono text-[10px] text-[#7F9099]">100 積分</div>
          </div>
          <Settings2 className="w-4 h-4 text-[#7F9099]" strokeWidth={1.5} />
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────
// Top header
// ─────────────────────────────────────────────────────────
function TopBar({ current }) {
  const step = STEPS.find((s) => s.id === current);
  const stepIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="border-b border-[#263642] bg-[#0D141B]/80 px-4 pb-4 pt-5 sm:px-6 md:px-8 md:pb-6 md:pt-8 lg:px-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[11px] tracking-[0.3em] text-[#79C7D4]">
            STEP {step.num} — {step.subtitle.toUpperCase()}
          </div>
          <h1 className="font-serif-cn text-2xl font-medium tracking-wide text-[#F2F6F7] sm:text-3xl lg:text-4xl">
            {step.label}
            <span className="ml-2 hidden font-display text-xl font-normal italic text-[#55AFC0]/70 sm:inline lg:ml-3 lg:text-2xl">
              {step.subtitle}
            </span>
          </h1>
        </div>
        <div className="hidden text-right sm:block">
          <div className="font-fraunces italic text-[#8796A1] text-sm">
            《黑髮魔女她富可敵國》
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-wider text-[#7F9099]">
            DRAFT · {String(stepIdx + 1).padStart(2, "0")}/{STEPS.length}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 flex items-center gap-1 md:mt-6">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-px flex-1 transition-all ${
              i <= stepIdx ? "bg-[#3E73B9]" : "bg-[#17232D]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// HOME PAGE — OPC vs BCP
// ─────────────────────────────────────────────────────────
function HomePage({ setCurrent }) {
  return (
    <div className="fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10">
      <div className="max-w-5xl">
        <p className="font-fraunces italic text-[#A7B3BC] text-lg mb-2">A new kind of studio.</p>
        <p className="font-serif-cn text-[#C6D1D6] text-base leading-relaxed max-w-2xl">
          從一句靈感到一部成片,不再需要切換軟體。
          <span className="text-[#55AFC0]/80">劇本、分鏡、配音、剪輯</span>
          ,全都在這裡。
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 lg:mt-12 lg:grid-cols-2 lg:gap-6">
          {/* OPC */}
          <button
            onClick={() => setCurrent("script")}
            className="group relative bg-[#111B24]/40 border border-[#263642] hover:border-[#55AFC0]/50 rounded-sm p-8 text-left transition-all overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-[#55AFC0]/[0.08] rounded-full blur-3xl group-hover:bg-[#55AFC0]/10 transition-all" />
            <div className="relative">
              <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-[#79C7D4]">
                FOR · INDIVIDUAL
              </div>
              <h2 className="font-display text-5xl font-semibold italic text-[#6FC7D5] mb-1">
                OPC
              </h2>
              <div className="font-fraunces italic text-[#8796A1] text-sm mb-6">
                One Person Company
              </div>
              <p className="font-serif-cn text-[#C6D1D6] text-sm leading-relaxed mb-8">
                個人創作者的精細工作台。從一句話想法開始,逐個分鏡打磨,
                每一幀都由你親自定稿。
              </p>
              <div className="space-y-1.5 mb-8">
                {["一句話 → 完整劇本", "分鏡逐幀調整", "多模型對比生圖", "角色配音可調情緒"].map(
                  (f) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <div className="w-1 h-1 bg-[#3E73B9] rounded-full" />
                      <span className="font-body text-[#A7B3BC]">{f}</span>
                    </div>
                  )
                )}
              </div>
              <div className="flex items-center gap-2 text-[#6FC7D5] font-fraunces italic text-sm group-hover:gap-3 transition-all">
                Begin <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </div>
            </div>
          </button>

          {/* BCP */}
          <div className="relative bg-[#111B24]/20 border border-[#263642]/40 rounded-sm p-8 opacity-60">
            <div className="font-mono text-[10px] tracking-[0.3em] text-[#8796A1] mb-3">
              FOR · TEAM
            </div>
            <h2 className="font-display text-5xl font-semibold italic text-[#A7B3BC] mb-1">
              BCP
            </h2>
            <div className="mb-6 font-fraunces text-sm italic text-[#7F9099]">
              Batch Creation Pipeline
            </div>
            <p className="font-serif-cn text-[#8796A1] text-sm leading-relaxed mb-8">
              專業團隊的批量產線。一次導入分鏡腳本,一次生成全部分鏡視頻,
              工業化交付。
            </p>
            <div className="space-y-1.5 mb-8">
              {["分鏡腳本批量導入", "並行渲染所有鏡頭", "中稿/備用版本管理", "團隊協作標記"].map(
                (f) => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <div className="w-1 h-1 bg-[#51626D] rounded-full" />
                    <span className="font-body text-[#8796A1]">{f}</span>
                  </div>
                )
              )}
            </div>
            <div className="font-mono text-[10px] tracking-wider text-[#7F9099]">
              COMING NEXT EPISODE
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-12 flex items-center justify-between">
          <div className="font-fraunces text-sm italic text-[#7F9099]">
            —— 從手作坊到規模工業
          </div>
          <div className="font-mono text-[10px] tracking-wider text-[#7F9099]">
            CONCEPT · INTERNAL REFERENCE
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SCRIPT PAGE
// ─────────────────────────────────────────────────────────
function ScriptPage({ setCurrent }) {
  const [idea, setIdea] = useState(
    "現代假名媛魂穿魔法世界,綁定神豪系統用現代知識逆襲"
  );
  const [generated, setGenerated] = useState(true);

  const startMethods = [
    { icon: Sparkles, label: "一句話想法", desc: "新手友好", active: true },
    { icon: Upload, label: "導入小說", desc: "AI 自動拆解" },
    { icon: Layers, label: "導入分鏡", desc: "專業團隊" },
    { icon: PenLine, label: "空白手寫", desc: "完全自定義" },
  ];

  return (
    <div className="fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10">
      {/* Method selector */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:mb-10 lg:grid-cols-4">
        {startMethods.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.label}
              className={`flex items-center gap-3 px-4 py-3 rounded-sm border text-left transition-all ${
                m.active
                  ? "bg-[#55AFC0]/[0.08] border-[#55AFC0]/40"
                  : "bg-[#111B24]/30 border-[#263642]/50 hover:border-[#354956]"
              }`}
            >
              <Icon
                className={`w-4 h-4 ${m.active ? "text-[#6FC7D5]" : "text-[#8796A1]"}`}
                strokeWidth={1.5}
              />
              <div>
                <div
                  className={`font-serif-cn text-sm ${
                    m.active ? "text-[#DFF8FC]" : "text-[#C6D1D6]"
                  }`}
                >
                  {m.label}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[#7F9099]">{m.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {/* Left: Input */}
        <div>
          <div className="font-fraunces italic text-[#55AFC0]/80 text-sm mb-3">Your Spark</div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            className="w-full h-32 bg-[#070B0F] border border-[#263642] rounded-sm px-5 py-4 font-serif-cn text-[#DCE5E8] text-base leading-relaxed resize-none focus:border-[#55AFC0]/60 focus:outline-none"
          />

          <div className="mt-6 space-y-4">
            <div>
              <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">
                畫面比例 · ASPECT
              </div>
              <div className="flex gap-2">
                {[
                  { l: "9:16", k: "豎屏" },
                  { l: "16:9", k: "橫屏" },
                  { l: "1:1", k: "方形" },
                  { l: "4:3", k: "經典" },
                ].map((r, i) => (
                  <button
                    key={r.l}
                    className={`px-3 py-2 border font-mono text-xs rounded-sm transition-all ${
                      i === 0
                        ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/10"
                        : "border-[#263642] text-[#8796A1] hover:border-[#354956]"
                    }`}
                  >
                    {r.l}
                    <span className="font-serif-cn text-[10px] ml-1.5 opacity-70">{r.k}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">
                畫面風格 · STYLE
              </div>
              <div className="flex flex-wrap gap-2">
                {["科幻", "2D 動畫", "水墨", "像素風", "油畫", "線稿"].map((s, i) => (
                  <button
                    key={s}
                    className={`px-3 py-1.5 border font-serif-cn text-sm rounded-sm transition-all ${
                      i === 0
                        ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/10"
                        : "border-[#263642] text-[#A7B3BC] hover:border-[#354956]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={() => setGenerated(true)}
            className="mt-8 w-full bg-[#3E73B9] hover:bg-[#4B82C8] text-[#070B0F] font-serif-cn text-base font-medium py-3 rounded-sm flex items-center justify-center gap-2 transition-all"
          >
            <Wand2 className="w-4 h-4" strokeWidth={2} />
            生成劇本
          </button>
        </div>

        {/* Right: Generated script preview */}
        <div className="relative">
          <div className="absolute -top-3 left-4 bg-[#111B24] px-3 font-fraunces italic text-[#55AFC0]/80 text-sm">
            AI Draft
          </div>
          <div className="bg-[#111B24]/40 border border-[#263642] rounded-sm p-6 max-h-[480px] overflow-y-auto">
            {generated && (
              <div className="space-y-5 fade-in">
                <div>
                  <div className="mb-1 font-mono text-[10px] tracking-wider text-[#79C7D4]">
                    TITLE
                  </div>
                  <div className="font-serif-cn text-xl text-[#F2F6F7]">
                    黑髮魔女她富可敵國
                  </div>
                </div>

                <div>
                  <div className="mb-1 font-mono text-[10px] tracking-wider text-[#79C7D4]">
                    LOGLINE
                  </div>
                  <div className="font-serif-cn text-sm text-[#C6D1D6] leading-relaxed">
                    現代打工人羅薇魂穿魔法世界假名媛之身,憑藉消費返利系統與
                    九年義務教育之力,於異界貴族鬥爭中扮豬吃虎,逆襲問鼎。
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="mb-1 font-mono text-[10px] tracking-wider text-[#79C7D4]">
                      CORE
                    </div>
                    <div className="font-serif-cn text-sm text-[#C6D1D6]">
                      穿越 · 系統 · 扮豬吃虎
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 font-mono text-[10px] tracking-wider text-[#79C7D4]">
                      ARC
                    </div>
                    <div className="font-serif-cn text-sm text-[#C6D1D6]">
                      6 階段 · 約 60 分鏡
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#263642] pt-5">
                  <div className="mb-3 font-mono text-[10px] tracking-wider text-[#79C7D4]">
                    SCENE 01 · OPENING
                  </div>
                  <div className="space-y-2 font-serif-cn text-sm">
                    <div>
                      <span className="text-[#55AFC0]/80 italic">場景 ·</span>{" "}
                      <span className="text-[#C6D1D6]">
                        魔法學院主廣場,夕陽斜照,魔紋大典前夕。
                      </span>
                    </div>
                    <div>
                      <span className="text-[#55AFC0]/80 italic">人物 ·</span>{" "}
                      <span className="text-[#C6D1D6]">
                        羅薇(黑髮、現代靈魂)、西里斯王子(冷峻配角)。
                      </span>
                    </div>
                    <div>
                      <span className="text-[#55AFC0]/80 italic">對白 ·</span>{" "}
                      <span className="text-[#C6D1D6]">
                        「在這個世界,本小姐連一根香蔥都能炒出股票來。」
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setCurrent("subjects")}
                  className="w-full bg-[#17232D]/50 hover:bg-[#17232D] border border-[#263642] hover:border-[#55AFC0]/40 text-[#DCE5E8] font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all mt-4"
                >
                  審核通過,進入主體生成
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SUBJECTS PAGE
// ─────────────────────────────────────────────────────────
function SubjectsPage({ setCurrent }) {
  const [tab, setTab] = useState("character");

  const characters = [
    { name: "羅薇", role: "核心主角", bg: "bg-img-3", desc: "黑髮黑瞳,現代靈魂" },
    { name: "西里斯", role: "男主", bg: "bg-img-2", desc: "金髮王子,冷峻清貴" },
    { name: "紅髮女孩", role: "配角", bg: "bg-img-5", desc: "妖族,赤焰瞳孔" },
    { name: "教皇", role: "重要路人", bg: "bg-img-1", desc: "白袍長者,神秘莫測" },
  ];

  const scenes = [
    { name: "魔法學院主廣場", bg: "bg-img-4" },
    { name: "雾原國邊境", bg: "bg-img-6" },
    { name: "教皇宣講聖殿", bg: "bg-img-1" },
    { name: "魔獸山地下室", bg: "bg-img-3" },
  ];

  const props = [
    { name: "消費返利系統", bg: "bg-img-2" },
    { name: "羅薇的火鍋鋪", bg: "bg-img-5" },
    { name: "感冒靈藥劑", bg: "bg-img-6" },
    { name: "魔紋契約書", bg: "bg-img-1" },
  ];

  const tabs = [
    { id: "character", label: "角色", count: 4 },
    { id: "scene", label: "場景", count: 4 },
    { id: "prop", label: "道具", count: 4 },
  ];

  const items = tab === "character" ? characters : tab === "scene" ? scenes : props;

  return (
    <div className="fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-1 rounded-sm border border-[#263642]/50 bg-[#111B24]/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2 rounded-sm font-serif-cn text-sm transition-all ${
                tab === t.id ? "bg-[#55AFC0]/10 text-[#6FC7D5]" : "text-[#A7B3BC]"
              }`}
            >
              {t.label}
              <span className="font-mono text-[10px] ml-2 opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-[#55AFC0]/30 text-[#6FC7D5] font-serif-cn text-sm rounded-sm hover:bg-[#55AFC0]/[0.08] transition-all">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} /> 新增主體
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item, i) => (
          <div
            key={i}
            className="group bg-[#111B24]/30 border border-[#263642]/50 rounded-sm overflow-hidden hover:border-[#55AFC0]/40 transition-all"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className={`aspect-[3/4] ${item.bg} relative overflow-hidden`}>
              <div className="absolute inset-0 bg-gradient-to-t from-[#070B0F]/95 via-[#070B0F]/30 to-transparent" />
              <div className="absolute top-3 left-3 font-mono text-[9px] tracking-[0.2em] text-[#C6D1D6]/80 bg-[#070B0F]/40 px-2 py-1 rounded-sm backdrop-blur-sm">
                {String(i + 1).padStart(3, "0")}
              </div>
              {tab === "character" && (
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="font-fraunces italic text-[#8AD7E2]/90 text-[11px]">
                    {item.role}
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3">
              <div className="font-serif-cn text-[#F2F6F7] text-base">{item.name}</div>
              {item.desc && (
                <div className="font-body text-[#8796A1] text-xs mt-1 leading-relaxed">
                  {item.desc}
                </div>
              )}
            </div>
            <div className="px-4 pb-3 flex items-center justify-between border-t border-[#263642]/50 pt-2 mt-1">
              <button className="font-mono text-[10px] text-[#8796A1] hover:text-[#6FC7D5] tracking-wider transition-all">
                重新生成
              </button>
              <button className="font-mono text-[10px] tracking-wider text-[#C89432] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]">
                ✓ 鎖定
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-4 rounded-sm border border-[#263642] bg-[#111B24]/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="font-fraunces italic text-[#55AFC0]/80 text-sm">All set?</div>
          <div className="font-serif-cn text-[#C6D1D6] text-sm mt-0.5">
            12 / 12 主體已就緒,可進入分鏡編排
          </div>
        </div>
        <button
          onClick={() => setCurrent("storyboard")}
          className="bg-[#3E73B9] hover:bg-[#4B82C8] text-[#070B0F] font-serif-cn text-sm font-medium px-6 py-2.5 rounded-sm flex items-center gap-2 transition-all"
        >
          進入分鏡 <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STORYBOARD PAGE — the heart of the tool
// ─────────────────────────────────────────────────────────
function StoryboardPage({ setCurrent }) {
  const [activeShot, setActiveShot] = useState(2);
  const [selectedModel, setSelectedModel] = useState(0);

  const shots = [
    { id: 1, label: "01", title: "羅薇墜入魔法世界", time: "0:00–0:04", status: "done" },
    { id: 2, label: "02", title: "黑髮少女睜眼,夕陽逆光", time: "0:04–0:09", status: "active" },
    { id: 3, label: "03", title: "西里斯王子驚鴻一瞥", time: "0:09–0:13", status: "draft" },
    { id: 4, label: "04", title: "羅薇打量陌生環境", time: "0:13–0:17", status: "draft" },
    { id: 5, label: "05", title: "系統提示音響起", time: "0:17–0:21", status: "pending" },
    { id: 6, label: "06", title: "她揚起神秘微笑", time: "0:21–0:25", status: "pending" },
  ];

  const models = [
    { name: "騰訊混元", tag: "HunYuan", bg: "bg-img-2", note: "光影層次最強" },
    { name: "豆包", tag: "Doubao", bg: "bg-img-3", note: "氛圍感最佳" },
    { name: "可靈", tag: "Kling", bg: "bg-img-5", note: "細節最豐富" },
  ];

  return (
    <div className="flex flex-col h-full fade-in">
      {/* Top: Storyboard strip */}
      <div className="border-b border-[#263642] px-4 pb-4 pt-6 sm:px-6 md:px-8 lg:px-12 lg:pt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="font-fraunces italic text-[#55AFC0]/80 text-sm">Storyboard Strip</div>
          <div className="font-mono text-[10px] text-[#8796A1] tracking-wider">
            6 SHOTS · 25s · DRAFT 03
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {shots.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveShot(s.id)}
              className={`flex-shrink-0 w-44 border rounded-sm overflow-hidden text-left transition-all ${
                activeShot === s.id
                  ? "border-[#55AFC0]/60 ring-2 ring-[#55AFC0]/20"
                  : "border-[#263642]/60 hover:border-[#354956]"
              }`}
            >
              <div className={`h-24 bg-img-${(s.id % 6) + 1} relative`}>
                <div className="absolute inset-0 bg-gradient-to-t from-[#070B0F]/90 via-transparent to-transparent" />
                <div className="absolute top-1.5 left-2 font-mono text-[10px] text-[#DCE5E8] bg-[#070B0F]/50 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  #{s.label}
                </div>
                {s.status === "done" && (
                  <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-[#3E73B9] flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-[#070B0F]" strokeWidth={3} />
                  </div>
                )}
                {s.status === "pending" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#070B0F]/70">
                    <ImageIcon className="h-5 w-5 text-[#7F9099]" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <div className="px-2 py-2 bg-[#111B24]/40">
                <div className="font-serif-cn text-[#DCE5E8] text-xs truncate">{s.title}</div>
                <div className="font-mono text-[9px] text-[#8796A1] mt-0.5">{s.time}</div>
              </div>
            </button>
          ))}
          <button className="flex-shrink-0 w-44 h-[124px] border border-dashed border-[#354956] hover:border-[#55AFC0]/40 text-[#8796A1] hover:text-[#6FC7D5] rounded-sm flex flex-col items-center justify-center gap-1 transition-all">
            <Plus className="w-5 h-5" strokeWidth={1.5} />
            <span className="font-fraunces italic text-xs">Add shot</span>
          </button>
        </div>
      </div>

      {/* Main work area */}
      <div className="grid flex-1 grid-cols-1 gap-8 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 xl:grid-cols-12 xl:gap-6 xl:px-12">
        {/* Left: Prompt builder */}
        <div className="space-y-5 xl:col-span-3">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              SHOT 02 · 提示詞
            </div>
            <div className="bg-[#111B24]/40 border border-[#263642] rounded-sm p-3 font-serif-cn text-sm text-[#C6D1D6] leading-relaxed">
              黑髮少女緩緩睜眼,陽光自背後灑落,
              <span className="text-[#6FC7D5]">逆光</span>剪影,
              神秘感,長髮微揚,魔法粒子環繞。
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">視角</div>
            <div className="grid grid-cols-2 gap-1.5">
              {["平視", "仰視", "俯視", "傾斜"].map((v, i) => (
                <button
                  key={v}
                  className={`px-2 py-1.5 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 0
                      ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/[0.08]"
                      : "border-[#263642] text-[#8796A1]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">景別</div>
            <div className="grid grid-cols-3 gap-1.5">
              {["遠景", "全景", "中景", "近景", "特寫"].map((v, i) => (
                <button
                  key={v}
                  className={`px-2 py-1.5 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 4
                      ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/[0.08]"
                      : "border-[#263642] text-[#8796A1]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">運鏡</div>
            <div className="space-y-1">
              {[
                { l: "中度推進", a: true },
                { l: "搖降", a: false },
                { l: "手持", a: false },
                { l: "快速變焦", a: false },
                { l: "升格", a: false },
              ].map((v) => (
                <button
                  key={v.l}
                  className={`w-full px-2.5 py-1.5 text-xs font-serif-cn text-left rounded-sm transition-all flex justify-between items-center ${
                    v.a
                      ? "bg-[#55AFC0]/[0.08] text-[#6FC7D5] border border-[#55AFC0]/30"
                      : "text-[#8796A1] border border-transparent hover:bg-[#111B24]/40"
                  }`}
                >
                  <span>{v.l}</span>
                  {v.a && <Check className="w-3 h-3" strokeWidth={2} />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-[#8796A1] mb-2">
              質量詞
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["逆光", "丁達爾", "粒子", "4K", "電影感"].map((q, i) => (
                <span
                  key={q}
                  className={`px-2 py-1 text-[11px] font-serif-cn rounded-sm border ${
                    i < 3
                      ? "border-[#55AFC0]/30 text-[#6FC7D5] bg-[#55AFC0]/[0.08]"
                      : "border-[#263642] text-[#8796A1]"
                  }`}
                >
                  {q}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Multi-model output */}
        <div className="xl:col-span-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-fraunces italic text-[#55AFC0]/80 text-sm">
              Multi-Model Comparison
            </div>
            <button className="font-mono text-[10px] tracking-wider text-[#55AFC0] border border-[#55AFC0]/40 px-3 py-1.5 rounded-sm hover:bg-[#55AFC0]/[0.08] transition-all flex items-center gap-1.5">
              <Wand2 className="w-3 h-3" strokeWidth={2} /> 一鍵全部生成
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {models.map((m, i) => (
              <button
                key={m.name}
                onClick={() => setSelectedModel(i)}
                className={`group rounded-sm overflow-hidden border-2 transition-all text-left ${
                  selectedModel === i
                    ? "border-[#55AFC0] ring-4 ring-[#55AFC0]/15"
                    : "border-[#263642]/60 hover:border-[#354956]"
                }`}
              >
                <div className={`aspect-square ${m.bg} relative`}>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#070B0F]/80 via-transparent to-[#070B0F]/30" />
                  <div className="absolute top-2 left-2 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#4B82C8] pulse-cyan" />
                    <span className="font-mono text-[10px] text-[#DCE5E8] tracking-wider bg-[#070B0F]/40 backdrop-blur-sm px-2 py-0.5 rounded">
                      {m.tag}
                    </span>
                  </div>
                  {selectedModel === i && (
                    <div className="absolute top-2 right-2 bg-[#3E73B9] text-[#070B0F] px-2 py-0.5 font-mono text-[9px] tracking-wider rounded">
                      中稿
                    </div>
                  )}
                </div>
                <div className="bg-[#111B24]/60 px-3 py-2.5">
                  <div className="font-serif-cn text-[#F2F6F7] text-sm">{m.name}</div>
                  <div className="font-fraunces italic text-[#8796A1] text-[11px] mt-0.5">
                    {m.note}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Action row */}
          <div className="mt-5 flex items-center gap-3">
            <button className="flex-1 bg-[#111B24]/50 border border-[#263642] hover:border-[#55AFC0]/40 text-[#C6D1D6] hover:text-[#6FC7D5] font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all">
              <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
              重新生成
            </button>
            <button className="flex-1 bg-[#55AFC0]/10 border border-[#55AFC0]/40 text-[#6FC7D5] font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 hover:bg-[#55AFC0]/15 transition-all">
              <Video className="w-3.5 h-3.5" strokeWidth={1.5} />
              首尾幀生視頻
            </button>
          </div>

          {/* Generated video result */}
          <div className="mt-5 bg-[#111B24]/30 border border-[#263642] rounded-sm p-3">
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 bg-img-3 relative rounded-sm overflow-hidden flex-shrink-0">
                <div className="absolute inset-0 flex items-center justify-center bg-[#070B0F]/40">
                  <Play
                    className="w-7 h-7 text-[#8AD7E2]"
                    strokeWidth={1.5}
                    fill="currentColor"
                  />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-serif-cn text-[#F2F6F7] text-sm">
                  鏡頭 02 · 視頻已生成
                </div>
                <div className="font-mono text-[10px] text-[#8796A1] mt-1 tracking-wider">
                  4.2s · 1080P · DOUBAO V3
                </div>
                <div className="mt-2 h-1 bg-[#17232D] rounded-full overflow-hidden">
                  <div className="h-full w-2/5 bg-[#3E73B9] rounded-full" />
                </div>
              </div>
              <button className="text-[#8796A1] hover:text-[#6FC7D5] transition-all">
                <Eye className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Inspector */}
        <div className="space-y-5 xl:col-span-3">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              主體 · CAST
            </div>
            <div className="space-y-1.5">
              {[
                { name: "羅薇", role: "主角", b: "bg-img-3" },
                { name: "魔法學院廣場", role: "場景", b: "bg-img-4" },
              ].map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-2.5 bg-[#111B24]/40 border border-[#263642]/60 rounded-sm px-2.5 py-1.5"
                >
                  <div className={`w-7 h-7 rounded-sm ${c.b} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-serif-cn text-[#DCE5E8] text-xs truncate">
                      {c.name}
                    </div>
                    <div className="font-mono text-[9px] text-[#8796A1] tracking-wider mt-0.5">
                      {c.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              音頻 · AUDIO
            </div>
            <div className="bg-[#111B24]/40 border border-[#263642]/60 rounded-sm p-3">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 className="w-3.5 h-3.5 text-[#55AFC0]" strokeWidth={1.5} />
                <div className="font-serif-cn text-[#DCE5E8] text-xs">
                  少女 · 神秘 · 中速
                </div>
              </div>
              {/* fake waveform */}
              <div className="flex items-center gap-0.5 h-8">
                {[3, 5, 4, 7, 6, 8, 5, 9, 7, 6, 8, 4, 6, 7, 5, 8, 6, 4, 7, 5, 6, 8, 5, 4].map(
                  (h, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-[#55AFC0]/40 rounded-full"
                      style={{ height: `${h * 3}px` }}
                    />
                  )
                )}
              </div>
              <div className="font-fraunces italic text-[#A7B3BC] text-xs mt-2 leading-relaxed">
                「在這個世界...本小姐連香蔥都能炒成股票。」
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              註記 · NOTES
            </div>
            <textarea
              defaultValue="逆光剪影為關鍵,粒子要顯眼但不喧賓奪主"
              className="w-full bg-[#111B24]/40 border border-[#263642]/60 rounded-sm px-3 py-2 font-serif-cn text-xs text-[#C6D1D6] leading-relaxed resize-none focus:border-[#55AFC0]/40 focus:outline-none"
              rows="3"
            />
          </div>

          <button
            onClick={() => setCurrent("voice")}
            className="w-full bg-[#3E73B9] hover:bg-[#4B82C8] text-[#070B0F] font-serif-cn text-sm font-medium py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all"
          >
            進入配音
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// VOICE PAGE
// ─────────────────────────────────────────────────────────
function VoicePage({ setCurrent }) {
  const [selected, setSelected] = useState(2);
  const voices = [
    { name: "晨曦少女", gender: "女", age: "16-22", emotion: "明亮 · 俏皮", playing: false },
    { name: "魅影貴公子", gender: "男", age: "22-30", emotion: "冷峻 · 清貴", playing: false },
    { name: "黑髮謎語", gender: "女", age: "18-25", emotion: "神秘 · 慵懶", playing: true },
    { name: "教皇之聲", gender: "男", age: "50+", emotion: "莊嚴 · 低沉", playing: false },
    { name: "稚嫩童聲", gender: "童", age: "8-12", emotion: "純真 · 清脆", playing: false },
    { name: "煙嗓御姐", gender: "女", age: "25-35", emotion: "成熟 · 性感", playing: false },
  ];

  return (
    <div className="fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Filter rail */}
        <div className="space-y-6 lg:col-span-1">
          <div>
            <div className="mb-3 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              篩選 · 性別
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["全部", "女", "男", "童", "群演", "特殊"].map((g, i) => (
                <button
                  key={g}
                  className={`px-3 py-2 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 0
                      ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/[0.08]"
                      : "border-[#263642] text-[#8796A1]"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 font-mono text-[10px] tracking-wider text-[#79C7D4]">
              篩選 · 情緒
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                "中性",
                "歡快",
                "悲傷",
                "憤怒",
                "驚訝",
                "神秘",
                "溫柔",
                "莊嚴",
                "俏皮",
              ].map((e, i) => (
                <button
                  key={e}
                  className={`px-2.5 py-1.5 text-xs font-serif-cn rounded-sm border transition-all ${
                    i === 5
                      ? "border-[#55AFC0]/50 text-[#6FC7D5] bg-[#55AFC0]/[0.08]"
                      : "border-[#263642] text-[#8796A1]"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#111B24]/40 border border-[#263642] rounded-sm p-4">
            <div className="font-fraunces italic text-[#55AFC0]/80 text-sm mb-3">Tuning</div>
            <div className="space-y-3">
              {[
                { l: "情緒強度", v: 70 },
                { l: "語速", v: 50 },
                { l: "語調", v: 55 },
              ].map((s) => (
                <div key={s.l}>
                  <div className="flex justify-between mb-1.5">
                    <span className="font-serif-cn text-xs text-[#A7B3BC]">{s.l}</span>
                    <span className="font-mono text-[10px] text-[#55AFC0]">{s.v}</span>
                  </div>
                  <div className="h-1 bg-[#17232D] rounded-full">
                    <div
                      className="h-full bg-[#3E73B9] rounded-full"
                      style={{ width: `${s.v}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Voice grid */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="font-fraunces italic text-[#55AFC0]/80 text-sm">
              Voices for 「羅薇」
            </div>
            <div className="font-mono text-[10px] text-[#8796A1] tracking-wider">
              247 VOICES · 6 SHOWING
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {voices.map((v, i) => (
              <button
                key={v.name}
                onClick={() => setSelected(i)}
                className={`group flex items-center gap-4 px-4 py-4 border rounded-sm text-left transition-all ${
                  selected === i
                    ? "border-[#55AFC0]/60 bg-[#55AFC0]/[0.08]"
                    : "border-[#263642]/60 hover:border-[#354956] bg-[#111B24]/30"
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                    selected === i ? "bg-[#3E73B9] text-[#070B0F]" : "bg-[#17232D] text-[#C6D1D6]"
                  }`}
                >
                  {v.playing ? (
                    <Pause className="w-5 h-5" strokeWidth={2} fill="currentColor" />
                  ) : (
                    <Play className="w-5 h-5" strokeWidth={2} fill="currentColor" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <div
                      className={`font-serif-cn text-base ${
                        selected === i ? "text-[#DFF8FC]" : "text-[#DCE5E8]"
                      }`}
                    >
                      {v.name}
                    </div>
                    <div className="font-mono text-[10px] tracking-wider text-[#7F9099]">
                      {v.gender} · {v.age}
                    </div>
                  </div>
                  <div className="font-fraunces italic text-[#8796A1] text-xs mt-1">
                    {v.emotion}
                  </div>
                  {v.playing && (
                    <div className="flex items-center gap-0.5 mt-2 h-3">
                      {[2, 4, 3, 5, 4, 6, 4, 5, 3, 4, 5, 3, 4].map((h, i) => (
                        <div
                          key={i}
                          className="w-0.5 bg-[#3E73B9] rounded-full"
                          style={{ height: `${h * 2}px` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {selected === i && (
                  <Star className="w-4 h-4 text-[#6FC7D5]" strokeWidth={2} fill="currentColor" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-sm border border-[#263642] bg-[#111B24]/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-fraunces italic text-[#55AFC0]/80 text-xs">Selected</div>
              <div className="font-serif-cn text-[#DCE5E8] text-sm mt-0.5">
                黑髮謎語 · 神秘 · 慵懶
              </div>
            </div>
            <button
              onClick={() => setCurrent("final")}
              className="bg-[#3E73B9] hover:bg-[#4B82C8] text-[#070B0F] font-serif-cn text-sm font-medium px-5 py-2 rounded-sm flex items-center gap-2 transition-all"
            >
              套用至全部 · 進入合成 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// FINAL PAGE
// ─────────────────────────────────────────────────────────
function FinalPage({ setCurrent }) {
  return (
    <div className="fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Player */}
        <div className="lg:col-span-2">
          <div className="aspect-video bg-[#070B0F] border border-[#263642] rounded-sm overflow-hidden relative">
            <div className="absolute inset-0 bg-img-3" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#070B0F]/95 via-[#070B0F]/20 to-[#070B0F]/40" />
            <div className="absolute inset-0 flex items-center justify-center">
              <button className="w-20 h-20 rounded-full bg-[#3E73B9] hover:bg-[#4B82C8] flex items-center justify-center transition-all pulse-cyan">
                <Play
                  className="w-9 h-9 text-[#070B0F] ml-1"
                  strokeWidth={2}
                  fill="currentColor"
                />
              </button>
            </div>
            <div className="absolute top-4 left-4 font-mono text-[10px] tracking-[0.3em] text-[#8AD7E2]/80">
              EP 01 · OPENING SEQUENCE
            </div>
            <div className="absolute bottom-4 left-4 right-4">
              <div className="font-display italic text-3xl text-[#DFF8FC]">
                黑髮魔女她富可敵國
              </div>
              <div className="font-fraunces italic text-[#A7B3BC] text-sm mt-1">
                Episode One · The Awakening
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-5 bg-[#111B24]/40 border border-[#263642]/60 rounded-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-fraunces italic text-[#55AFC0]/80 text-sm">Timeline</div>
              <div className="font-mono text-[10px] text-[#8796A1] tracking-wider">
                00:25 / 02:14
              </div>
            </div>
            <div className="flex gap-1 h-12">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div
                  key={i}
                  className={`flex-1 bg-img-${(i % 6) + 1} rounded-sm relative overflow-hidden ${
                    i <= 6 ? "" : "opacity-40"
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-[#070B0F]/40 to-transparent" />
                  <div className="absolute bottom-0.5 left-0.5 font-mono text-[8px] text-[#DCE5E8]">
                    {String(i).padStart(2, "0")}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1 h-3">
              {[3, 5, 4, 7, 6, 8, 5, 9, 7, 6, 8, 4, 6, 7, 5, 8, 6, 4, 7, 5, 6, 8, 5, 4, 7, 6, 5, 4, 6, 7, 5, 8, 6, 4, 5, 7, 6, 4].map(
                (h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-[#55AFC0]/40 rounded-full"
                    style={{ height: `${h * 1.5}px` }}
                  />
                )
              )}
            </div>
          </div>
        </div>

        {/* Stats & export */}
        <div className="space-y-5 lg:col-span-1">
          <div className="bg-[#111B24]/40 border border-[#263642] rounded-sm p-5">
            <div className="font-fraunces italic text-[#55AFC0]/80 text-sm mb-4">Sheet</div>
            <dl className="space-y-3">
              {[
                { k: "總分鏡", v: "12 個" },
                { k: "總時長", v: "2:14" },
                { k: "解析度", v: "1920 × 1080" },
                { k: "風格", v: "科幻 · 電影感" },
                { k: "已用積分", v: "47 / 100" },
                { k: "創作時長", v: "≈ 21 分鐘" },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex justify-between border-b border-[#263642]/50 pb-2 last:border-0"
                >
                  <dt className="font-serif-cn text-[#A7B3BC] text-sm">{row.k}</dt>
                  <dd className="font-mono text-[#DCE5E8] text-xs tracking-wider self-end">
                    {row.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <button className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#C89432] py-3 font-serif-cn text-base font-medium text-[#070B0F] transition-colors hover:bg-[#D9A84B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111B24]">
            <Download className="w-4 h-4" strokeWidth={2} />
            匯出 MP4 · 1080P
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button className="bg-[#111B24]/40 border border-[#263642] hover:border-[#55AFC0]/40 text-[#C6D1D6] font-serif-cn text-xs py-2.5 rounded-sm transition-all">
              下載分鏡素材
            </button>
            <button className="bg-[#111B24]/40 border border-[#263642] hover:border-[#55AFC0]/40 text-[#C6D1D6] font-serif-cn text-xs py-2.5 rounded-sm transition-all">
              查看劇本
            </button>
          </div>

          <div className="bg-gradient-to-br from-[#55AFC0]/[0.08] to-[#3E73B9]/10 border border-[#55AFC0]/20 rounded-sm p-4">
            <div className="font-fraunces italic text-[#6FC7D5] text-sm">
              From spark to screen.
            </div>
            <div className="font-serif-cn text-[#C6D1D6] text-xs mt-2 leading-relaxed">
              一句話到成片,21 分鐘。
              <br />
              版權歸你,免費商用。
            </div>
            <button
              onClick={() => setCurrent("home")}
              className="mt-4 font-fraunces italic text-[#6FC7D5] text-xs hover:gap-2 flex items-center gap-1 transition-all"
            >
              開始下一部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────
export default function App() {
  const [current, setCurrent] = useState("home");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "zh";

  const renderPage = () => {
    switch (current) {
      case "home":
        return <HomePage setCurrent={setCurrent} />;
      case "script":
        return <ScriptPage setCurrent={setCurrent} />;
      case "subjects":
        return <SubjectsPage setCurrent={setCurrent} />;
      case "storyboard":
        return <StoryboardPage setCurrent={setCurrent} />;
      case "voice":
        return <VoicePage setCurrent={setCurrent} />;
      case "final":
        return <FinalPage setCurrent={setCurrent} />;
      default:
        return <HomePage setCurrent={setCurrent} />;
    }
  };

  return (
    <>
      <style>{previewStyle}</style>
      <div className="kuiper-design-preview grain flex min-h-screen w-full min-w-0 flex-col overflow-x-hidden bg-[#070B0F] font-sans text-[#DCE5E8] md:h-screen md:flex-row">
        <Sidebar current={current} setCurrent={setCurrent} locale={locale} />
        <main className="flex min-w-0 flex-1 flex-col overflow-visible md:min-h-0 md:overflow-hidden">
          <TopBar current={current} />
          <div className="min-w-0 flex-1 overflow-visible md:overflow-y-auto">{renderPage()}</div>
        </main>
      </div>
    </>
  );
}
