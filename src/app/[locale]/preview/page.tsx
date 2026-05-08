/* eslint-disable @typescript-eslint/ban-ts-comment, no-restricted-imports */
// @ts-nocheck
// Standalone visual mockup ported from ~/Downloads/kino_mockup.jsx.
// Rendered at /[locale]/preview to give the user a feel for the
// proposed Kino-style layout without disturbing the real workspace.
// Data is hard-coded; no API calls. The two file-wide eslint-disables
// above are intentional: this is a frozen mockup port, not application
// code, so the icon-system rule and ts-nocheck ban don't apply.
'use client'

import React, { useState } from "react";
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
  { id: "subjects", num: "02", label: "主體", subtitle: "Subjects", icon: Users },
  { id: "storyboard", num: "03", label: "分鏡", subtitle: "Storyboard", icon: Layers },
  { id: "voice", num: "04", label: "配音", subtitle: "Voice", icon: Mic },
  { id: "final", num: "05", label: "成片", subtitle: "Final Cut", icon: Play },
];

const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Fraunces:ital,wght@0,300;0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@400;500;700;900&family=Noto+Sans+SC:wght@300;400;500;700&family=JetBrains+Mono:wght@300;400;500&display=swap');

  .font-display { font-family: 'Cormorant Garamond', 'Noto Serif SC', serif; }
  .font-serif-cn { font-family: 'Noto Serif SC', 'Cormorant Garamond', serif; }
  .font-body { font-family: 'Noto Sans SC', system-ui, sans-serif; }
  .font-mono { font-family: 'JetBrains Mono', monospace; }
  .font-fraunces { font-family: 'Fraunces', 'Noto Serif SC', serif; }

  .grain {
    background-image:
      radial-gradient(rgba(255,180,100,0.04) 1px, transparent 1px);
    background-size: 3px 3px;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .shimmer {
    background: linear-gradient(90deg,
      rgba(245,158,11,0) 0%,
      rgba(245,158,11,0.15) 50%,
      rgba(245,158,11,0) 100%);
    background-size: 200% 100%;
    animation: shimmer 2.5s infinite;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeInUp 0.5s ease forwards; }

  @keyframes pulse-amber {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(245,158,11,0); }
  }
  .pulse-amber { animation: pulse-amber 2s infinite; }

  /* Mock generated image gradient backgrounds */
  .bg-img-1 { background: linear-gradient(135deg, #7c2d12 0%, #b45309 40%, #1e293b 100%); }
  .bg-img-2 { background: linear-gradient(135deg, #1e1b4b 0%, #7c2d12 50%, #f59e0b 100%); }
  .bg-img-3 { background: linear-gradient(135deg, #4a044e 0%, #831843 50%, #7c2d12 100%); }
  .bg-img-4 { background: linear-gradient(135deg, #064e3b 0%, #1e3a8a 50%, #7c2d12 100%); }
  .bg-img-5 { background: linear-gradient(135deg, #422006 0%, #7c2d12 60%, #fbbf24 100%); }
  .bg-img-6 { background: linear-gradient(135deg, #18181b 0%, #44403c 50%, #f59e0b 100%); }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: rgba(0,0,0,0); }
  ::-webkit-scrollbar-thumb { background: rgba(245,158,11,0.2); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(245,158,11,0.4); }
`;

// ─────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────
function Sidebar({ current, setCurrent }) {
  return (
    <aside className="w-64 bg-stone-950 border-r border-amber-900/20 flex flex-col">
      {/* Logo */}
      <div className="px-7 pt-8 pb-10 border-b border-amber-900/15">
        <div className="flex items-baseline gap-1.5">
          <div className="font-display text-3xl font-semibold text-amber-400 italic tracking-tight">
            Kino
          </div>
          <div className="font-serif-cn text-xl text-stone-100 font-medium">視界</div>
        </div>
        <div className="font-mono text-[10px] text-stone-500 mt-1 tracking-[0.2em]">
          AI · MANHUA · STUDIO
        </div>
      </div>

      {/* Steps */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const active = step.id === current;
          const completed = STEPS.findIndex((s) => s.id === current) > STEPS.findIndex((s) => s.id === step.id);
          return (
            <button
              key={step.id}
              onClick={() => setCurrent(step.id)}
              className={`w-full group flex items-center gap-3 px-3 py-2.5 rounded-md transition-all ${
                active
                  ? "bg-amber-500/10 border border-amber-500/30"
                  : "border border-transparent hover:bg-stone-900/60"
              }`}
            >
              <div
                className={`font-mono text-[10px] tracking-wider w-6 ${
                  active ? "text-amber-400" : completed ? "text-amber-700" : "text-stone-600"
                }`}
              >
                {step.num}
              </div>
              <Icon
                className={`w-4 h-4 ${
                  active ? "text-amber-400" : completed ? "text-amber-700" : "text-stone-500"
                }`}
                strokeWidth={1.5}
              />
              <div className="flex-1 text-left">
                <div
                  className={`font-serif-cn text-sm leading-none ${
                    active ? "text-amber-100" : "text-stone-300"
                  }`}
                >
                  {step.label}
                </div>
                <div className="font-fraunces italic text-[10px] text-stone-600 mt-0.5">
                  {step.subtitle}
                </div>
              </div>
              {completed && <Check className="w-3 h-3 text-amber-700" strokeWidth={2} />}
            </button>
          );
        })}
      </nav>

      {/* User block */}
      <div className="px-5 py-5 border-t border-amber-900/15">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-rose-700 flex items-center justify-center font-display text-stone-100 text-sm">
            紫
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-body text-sm text-stone-200 truncate">紫月創作者</div>
            <div className="font-mono text-[10px] text-amber-600/70 mt-0.5">100 積分</div>
          </div>
          <Settings2 className="w-4 h-4 text-stone-600" strokeWidth={1.5} />
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
    <div className="px-12 pt-8 pb-6 border-b border-amber-900/15">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[11px] tracking-[0.3em] text-amber-600/80 mb-2">
            STEP {step.num} — {step.subtitle.toUpperCase()}
          </div>
          <h1 className="font-serif-cn text-4xl text-stone-100 font-medium tracking-wide">
            {step.label}
            <span className="font-display italic text-amber-500/70 text-2xl ml-3 font-normal">
              {step.subtitle}
            </span>
          </h1>
        </div>
        <div className="text-right">
          <div className="font-fraunces italic text-stone-500 text-sm">
            《黑髮魔女她富可敵國》
          </div>
          <div className="font-mono text-[10px] text-stone-600 mt-1 tracking-wider">
            DRAFT · {String(stepIdx + 1).padStart(2, "0")}/{STEPS.length}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-6 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-px flex-1 transition-all ${
              i <= stepIdx ? "bg-amber-500" : "bg-stone-800"
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
    <div className="px-12 py-10 fade-in">
      <div className="max-w-5xl">
        <p className="font-fraunces italic text-stone-400 text-lg mb-2">A new kind of studio.</p>
        <p className="font-serif-cn text-stone-300 text-base leading-relaxed max-w-2xl">
          從一句靈感到一部成片,不再需要切換軟體。
          <span className="text-amber-500/80">劇本、分鏡、配音、剪輯</span>
          ,全都在這裡。
        </p>

        <div className="mt-12 grid grid-cols-2 gap-6">
          {/* OPC */}
          <button
            onClick={() => setCurrent("script")}
            className="group relative bg-stone-900/40 border border-amber-900/25 hover:border-amber-500/50 rounded-sm p-8 text-left transition-all overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl group-hover:bg-amber-500/10 transition-all" />
            <div className="relative">
              <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600 mb-3">
                FOR · INDIVIDUAL
              </div>
              <h2 className="font-display text-5xl font-semibold italic text-amber-400 mb-1">
                OPC
              </h2>
              <div className="font-fraunces italic text-stone-500 text-sm mb-6">
                One Person Company
              </div>
              <p className="font-serif-cn text-stone-300 text-sm leading-relaxed mb-8">
                個人創作者的精細工作台。從一句話想法開始,逐個分鏡打磨,
                每一幀都由你親自定稿。
              </p>
              <div className="space-y-1.5 mb-8">
                {["一句話 → 完整劇本", "分鏡逐幀調整", "多模型對比生圖", "角色配音可調情緒"].map(
                  (f) => (
                    <div key={f} className="flex items-center gap-2 text-sm">
                      <div className="w-1 h-1 bg-amber-500 rounded-full" />
                      <span className="font-body text-stone-400">{f}</span>
                    </div>
                  )
                )}
              </div>
              <div className="flex items-center gap-2 text-amber-400 font-fraunces italic text-sm group-hover:gap-3 transition-all">
                Begin <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </div>
            </div>
          </button>

          {/* BCP */}
          <div className="relative bg-stone-900/20 border border-stone-800/40 rounded-sm p-8 opacity-60">
            <div className="font-mono text-[10px] tracking-[0.3em] text-stone-500 mb-3">
              FOR · TEAM
            </div>
            <h2 className="font-display text-5xl font-semibold italic text-stone-400 mb-1">
              BCP
            </h2>
            <div className="font-fraunces italic text-stone-600 text-sm mb-6">
              Batch Creation Pipeline
            </div>
            <p className="font-serif-cn text-stone-500 text-sm leading-relaxed mb-8">
              專業團隊的批量產線。一次導入分鏡腳本,一次生成全部分鏡視頻,
              工業化交付。
            </p>
            <div className="space-y-1.5 mb-8">
              {["分鏡腳本批量導入", "並行渲染所有鏡頭", "中稿/備用版本管理", "團隊協作標記"].map(
                (f) => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <div className="w-1 h-1 bg-stone-600 rounded-full" />
                    <span className="font-body text-stone-500">{f}</span>
                  </div>
                )
              )}
            </div>
            <div className="font-mono text-[10px] text-stone-600 tracking-wider">
              COMING NEXT EPISODE
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-12 flex items-center justify-between">
          <div className="font-fraunces italic text-stone-600 text-sm">
            —— 從手作坊到規模工業
          </div>
          <div className="font-mono text-[10px] text-stone-700 tracking-wider">
            v1.5 · vkino.cn
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
    <div className="px-12 py-10 fade-in">
      {/* Method selector */}
      <div className="grid grid-cols-4 gap-3 mb-10">
        {startMethods.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.label}
              className={`flex items-center gap-3 px-4 py-3 rounded-sm border text-left transition-all ${
                m.active
                  ? "bg-amber-500/8 border-amber-500/40"
                  : "bg-stone-900/30 border-stone-800/50 hover:border-stone-700"
              }`}
            >
              <Icon
                className={`w-4 h-4 ${m.active ? "text-amber-400" : "text-stone-500"}`}
                strokeWidth={1.5}
              />
              <div>
                <div
                  className={`font-serif-cn text-sm ${
                    m.active ? "text-amber-100" : "text-stone-300"
                  }`}
                >
                  {m.label}
                </div>
                <div className="font-mono text-[9px] text-stone-600 mt-0.5">{m.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Left: Input */}
        <div>
          <div className="font-fraunces italic text-amber-500/80 text-sm mb-3">Your Spark</div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            className="w-full h-32 bg-stone-950 border border-amber-900/30 rounded-sm px-5 py-4 font-serif-cn text-stone-200 text-base leading-relaxed resize-none focus:border-amber-500/60 focus:outline-none"
          />

          <div className="mt-6 space-y-4">
            <div>
              <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">
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
                        ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                        : "border-stone-800 text-stone-500 hover:border-stone-700"
                    }`}
                  >
                    {r.l}
                    <span className="font-serif-cn text-[10px] ml-1.5 opacity-70">{r.k}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">
                畫面風格 · STYLE
              </div>
              <div className="flex flex-wrap gap-2">
                {["科幻", "2D 動畫", "水墨", "像素風", "油畫", "線稿"].map((s, i) => (
                  <button
                    key={s}
                    className={`px-3 py-1.5 border font-serif-cn text-sm rounded-sm transition-all ${
                      i === 0
                        ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                        : "border-stone-800 text-stone-400 hover:border-stone-700"
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
            className="mt-8 w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-serif-cn text-base font-medium py-3 rounded-sm flex items-center justify-center gap-2 transition-all"
          >
            <Wand2 className="w-4 h-4" strokeWidth={2} />
            生成劇本
          </button>
        </div>

        {/* Right: Generated script preview */}
        <div className="relative">
          <div className="absolute -top-3 left-4 bg-stone-900 px-3 font-fraunces italic text-amber-500/80 text-sm">
            AI Draft
          </div>
          <div className="bg-stone-900/40 border border-amber-900/20 rounded-sm p-6 max-h-[480px] overflow-y-auto">
            {generated && (
              <div className="space-y-5 fade-in">
                <div>
                  <div className="font-mono text-[10px] tracking-wider text-amber-600/70 mb-1">
                    TITLE
                  </div>
                  <div className="font-serif-cn text-xl text-stone-100">
                    黑髮魔女她富可敵國
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] tracking-wider text-amber-600/70 mb-1">
                    LOGLINE
                  </div>
                  <div className="font-serif-cn text-sm text-stone-300 leading-relaxed">
                    現代打工人羅薇魂穿魔法世界假名媛之身,憑藉消費返利系統與
                    九年義務教育之力,於異界貴族鬥爭中扮豬吃虎,逆襲問鼎。
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="font-mono text-[10px] tracking-wider text-amber-600/70 mb-1">
                      CORE
                    </div>
                    <div className="font-serif-cn text-sm text-stone-300">
                      穿越 · 系統 · 扮豬吃虎
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] tracking-wider text-amber-600/70 mb-1">
                      ARC
                    </div>
                    <div className="font-serif-cn text-sm text-stone-300">
                      6 階段 · 約 60 分鏡
                    </div>
                  </div>
                </div>

                <div className="border-t border-amber-900/15 pt-5">
                  <div className="font-mono text-[10px] tracking-wider text-amber-600/70 mb-3">
                    SCENE 01 · OPENING
                  </div>
                  <div className="space-y-2 font-serif-cn text-sm">
                    <div>
                      <span className="text-amber-500/80 italic">場景 ·</span>{" "}
                      <span className="text-stone-300">
                        魔法學院主廣場,夕陽斜照,魔紋大典前夕。
                      </span>
                    </div>
                    <div>
                      <span className="text-amber-500/80 italic">人物 ·</span>{" "}
                      <span className="text-stone-300">
                        羅薇(黑髮、現代靈魂)、西里斯王子(冷峻配角)。
                      </span>
                    </div>
                    <div>
                      <span className="text-amber-500/80 italic">對白 ·</span>{" "}
                      <span className="text-stone-300">
                        「在這個世界,本小姐連一根香蔥都能炒出股票來。」
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setCurrent("subjects")}
                  className="w-full bg-stone-800/50 hover:bg-stone-800 border border-amber-900/30 hover:border-amber-500/40 text-stone-200 font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all mt-4"
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
    <div className="px-12 py-10 fade-in">
      <div className="flex items-center justify-between mb-8">
        <div className="flex gap-1 bg-stone-900/50 p-1 rounded-sm border border-stone-800/50">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2 rounded-sm font-serif-cn text-sm transition-all ${
                tab === t.id ? "bg-amber-500/10 text-amber-400" : "text-stone-400"
              }`}
            >
              {t.label}
              <span className="font-mono text-[10px] ml-2 opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-amber-500/30 text-amber-400 font-serif-cn text-sm rounded-sm hover:bg-amber-500/5 transition-all">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} /> 新增主體
        </button>
      </div>

      <div className="grid grid-cols-4 gap-5">
        {items.map((item, i) => (
          <div
            key={i}
            className="group bg-stone-900/30 border border-stone-800/50 rounded-sm overflow-hidden hover:border-amber-500/40 transition-all"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className={`aspect-[3/4] ${item.bg} relative overflow-hidden`}>
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/30 to-transparent" />
              <div className="absolute top-3 left-3 font-mono text-[9px] tracking-[0.2em] text-stone-300/80 bg-stone-950/40 px-2 py-1 rounded-sm backdrop-blur-sm">
                {String(i + 1).padStart(3, "0")}
              </div>
              {tab === "character" && (
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="font-fraunces italic text-amber-300/90 text-[11px]">
                    {item.role}
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 py-3">
              <div className="font-serif-cn text-stone-100 text-base">{item.name}</div>
              {item.desc && (
                <div className="font-body text-stone-500 text-xs mt-1 leading-relaxed">
                  {item.desc}
                </div>
              )}
            </div>
            <div className="px-4 pb-3 flex items-center justify-between border-t border-stone-800/50 pt-2 mt-1">
              <button className="font-mono text-[10px] text-stone-500 hover:text-amber-400 tracking-wider transition-all">
                重新生成
              </button>
              <button className="font-mono text-[10px] text-amber-500/70 tracking-wider">
                ✓ 鎖定
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-center justify-between bg-stone-900/30 border border-amber-900/20 rounded-sm px-6 py-4">
        <div>
          <div className="font-fraunces italic text-amber-500/80 text-sm">All set?</div>
          <div className="font-serif-cn text-stone-300 text-sm mt-0.5">
            12 / 12 主體已就緒,可進入分鏡編排
          </div>
        </div>
        <button
          onClick={() => setCurrent("storyboard")}
          className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-serif-cn text-sm font-medium px-6 py-2.5 rounded-sm flex items-center gap-2 transition-all"
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
      <div className="px-12 pt-8 pb-4 border-b border-amber-900/15">
        <div className="flex items-center justify-between mb-4">
          <div className="font-fraunces italic text-amber-500/80 text-sm">Storyboard Strip</div>
          <div className="font-mono text-[10px] text-stone-500 tracking-wider">
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
                  ? "border-amber-500/60 ring-2 ring-amber-500/20"
                  : "border-stone-800/60 hover:border-stone-700"
              }`}
            >
              <div className={`h-24 bg-img-${(s.id % 6) + 1} relative`}>
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-transparent to-transparent" />
                <div className="absolute top-1.5 left-2 font-mono text-[10px] text-stone-200 bg-stone-950/50 px-1.5 py-0.5 rounded backdrop-blur-sm">
                  #{s.label}
                </div>
                {s.status === "done" && (
                  <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-stone-950" strokeWidth={3} />
                  </div>
                )}
                {s.status === "pending" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-stone-950/70">
                    <ImageIcon className="w-5 h-5 text-stone-600" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <div className="px-2 py-2 bg-stone-900/40">
                <div className="font-serif-cn text-stone-200 text-xs truncate">{s.title}</div>
                <div className="font-mono text-[9px] text-stone-500 mt-0.5">{s.time}</div>
              </div>
            </button>
          ))}
          <button className="flex-shrink-0 w-44 h-[124px] border border-dashed border-stone-700 hover:border-amber-500/40 text-stone-500 hover:text-amber-400 rounded-sm flex flex-col items-center justify-center gap-1 transition-all">
            <Plus className="w-5 h-5" strokeWidth={1.5} />
            <span className="font-fraunces italic text-xs">Add shot</span>
          </button>
        </div>
      </div>

      {/* Main work area */}
      <div className="flex-1 grid grid-cols-12 gap-6 px-12 py-6 overflow-y-auto">
        {/* Left: Prompt builder */}
        <div className="col-span-3 space-y-5">
          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-2">
              SHOT 02 · 提示詞
            </div>
            <div className="bg-stone-900/40 border border-amber-900/20 rounded-sm p-3 font-serif-cn text-sm text-stone-300 leading-relaxed">
              黑髮少女緩緩睜眼,陽光自背後灑落,
              <span className="text-amber-400">逆光</span>剪影,
              神秘感,長髮微揚,魔法粒子環繞。
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">視角</div>
            <div className="grid grid-cols-2 gap-1.5">
              {["平視", "仰視", "俯視", "傾斜"].map((v, i) => (
                <button
                  key={v}
                  className={`px-2 py-1.5 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 0
                      ? "border-amber-500/50 text-amber-400 bg-amber-500/5"
                      : "border-stone-800 text-stone-500"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">景別</div>
            <div className="grid grid-cols-3 gap-1.5">
              {["遠景", "全景", "中景", "近景", "特寫"].map((v, i) => (
                <button
                  key={v}
                  className={`px-2 py-1.5 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 4
                      ? "border-amber-500/50 text-amber-400 bg-amber-500/5"
                      : "border-stone-800 text-stone-500"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">運鏡</div>
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
                      ? "bg-amber-500/8 text-amber-400 border border-amber-500/30"
                      : "text-stone-500 border border-transparent hover:bg-stone-900/40"
                  }`}
                >
                  <span>{v.l}</span>
                  {v.a && <Check className="w-3 h-3" strokeWidth={2} />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-stone-500 mb-2">
              質量詞
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["逆光", "丁達爾", "粒子", "4K", "電影感"].map((q, i) => (
                <span
                  key={q}
                  className={`px-2 py-1 text-[11px] font-serif-cn rounded-sm border ${
                    i < 3
                      ? "border-amber-500/30 text-amber-400 bg-amber-500/5"
                      : "border-stone-800 text-stone-500"
                  }`}
                >
                  {q}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Multi-model output */}
        <div className="col-span-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-fraunces italic text-amber-500/80 text-sm">
              Multi-Model Comparison
            </div>
            <button className="font-mono text-[10px] tracking-wider text-amber-500 border border-amber-500/40 px-3 py-1.5 rounded-sm hover:bg-amber-500/5 transition-all flex items-center gap-1.5">
              <Wand2 className="w-3 h-3" strokeWidth={2} /> 一鍵全部生成
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {models.map((m, i) => (
              <button
                key={m.name}
                onClick={() => setSelectedModel(i)}
                className={`group rounded-sm overflow-hidden border-2 transition-all text-left ${
                  selectedModel === i
                    ? "border-amber-500 ring-4 ring-amber-500/15"
                    : "border-stone-800/60 hover:border-stone-700"
                }`}
              >
                <div className={`aspect-square ${m.bg} relative`}>
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-stone-950/30" />
                  <div className="absolute top-2 left-2 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-amber" />
                    <span className="font-mono text-[10px] text-stone-200 tracking-wider bg-stone-950/40 backdrop-blur-sm px-2 py-0.5 rounded">
                      {m.tag}
                    </span>
                  </div>
                  {selectedModel === i && (
                    <div className="absolute top-2 right-2 bg-amber-500 text-stone-950 px-2 py-0.5 font-mono text-[9px] tracking-wider rounded">
                      中稿
                    </div>
                  )}
                </div>
                <div className="bg-stone-900/60 px-3 py-2.5">
                  <div className="font-serif-cn text-stone-100 text-sm">{m.name}</div>
                  <div className="font-fraunces italic text-stone-500 text-[11px] mt-0.5">
                    {m.note}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Action row */}
          <div className="mt-5 flex items-center gap-3">
            <button className="flex-1 bg-stone-900/50 border border-stone-800 hover:border-amber-500/40 text-stone-300 hover:text-amber-400 font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all">
              <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
              重新生成
            </button>
            <button className="flex-1 bg-amber-500/10 border border-amber-500/40 text-amber-400 font-serif-cn text-sm py-2.5 rounded-sm flex items-center justify-center gap-2 hover:bg-amber-500/15 transition-all">
              <Video className="w-3.5 h-3.5" strokeWidth={1.5} />
              首尾幀生視頻
            </button>
          </div>

          {/* Generated video result */}
          <div className="mt-5 bg-stone-900/30 border border-amber-900/20 rounded-sm p-3">
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 bg-img-3 relative rounded-sm overflow-hidden flex-shrink-0">
                <div className="absolute inset-0 flex items-center justify-center bg-stone-950/40">
                  <Play
                    className="w-7 h-7 text-amber-300"
                    strokeWidth={1.5}
                    fill="currentColor"
                  />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-serif-cn text-stone-100 text-sm">
                  鏡頭 02 · 視頻已生成
                </div>
                <div className="font-mono text-[10px] text-stone-500 mt-1 tracking-wider">
                  4.2s · 1080P · DOUBAO V3
                </div>
                <div className="mt-2 h-1 bg-stone-800 rounded-full overflow-hidden">
                  <div className="h-full w-2/5 bg-amber-500 rounded-full" />
                </div>
              </div>
              <button className="text-stone-500 hover:text-amber-400 transition-all">
                <Eye className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Inspector */}
        <div className="col-span-3 space-y-5">
          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-2">
              主體 · CAST
            </div>
            <div className="space-y-1.5">
              {[
                { name: "羅薇", role: "主角", b: "bg-img-3" },
                { name: "魔法學院廣場", role: "場景", b: "bg-img-4" },
              ].map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-2.5 bg-stone-900/40 border border-stone-800/60 rounded-sm px-2.5 py-1.5"
                >
                  <div className={`w-7 h-7 rounded-sm ${c.b} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-serif-cn text-stone-200 text-xs truncate">
                      {c.name}
                    </div>
                    <div className="font-mono text-[9px] text-stone-500 tracking-wider mt-0.5">
                      {c.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-2">
              音頻 · AUDIO
            </div>
            <div className="bg-stone-900/40 border border-stone-800/60 rounded-sm p-3">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
                <div className="font-serif-cn text-stone-200 text-xs">
                  少女 · 神秘 · 中速
                </div>
              </div>
              {/* fake waveform */}
              <div className="flex items-center gap-0.5 h-8">
                {[3, 5, 4, 7, 6, 8, 5, 9, 7, 6, 8, 4, 6, 7, 5, 8, 6, 4, 7, 5, 6, 8, 5, 4].map(
                  (h, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-amber-500/40 rounded-full"
                      style={{ height: `${h * 3}px` }}
                    />
                  )
                )}
              </div>
              <div className="font-fraunces italic text-stone-400 text-xs mt-2 leading-relaxed">
                「在這個世界...本小姐連香蔥都能炒成股票。」
              </div>
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-2">
              註記 · NOTES
            </div>
            <textarea
              defaultValue="逆光剪影為關鍵,粒子要顯眼但不喧賓奪主"
              className="w-full bg-stone-900/40 border border-stone-800/60 rounded-sm px-3 py-2 font-serif-cn text-xs text-stone-300 leading-relaxed resize-none focus:border-amber-500/40 focus:outline-none"
              rows="3"
            />
          </div>

          <button
            onClick={() => setCurrent("voice")}
            className="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-serif-cn text-sm font-medium py-2.5 rounded-sm flex items-center justify-center gap-2 transition-all"
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
    <div className="px-12 py-10 fade-in">
      <div className="grid grid-cols-3 gap-8">
        {/* Filter rail */}
        <div className="col-span-1 space-y-6">
          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-3">
              篩選 · 性別
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["全部", "女", "男", "童", "群演", "特殊"].map((g, i) => (
                <button
                  key={g}
                  className={`px-3 py-2 border text-xs font-serif-cn rounded-sm transition-all ${
                    i === 0
                      ? "border-amber-500/50 text-amber-400 bg-amber-500/5"
                      : "border-stone-800 text-stone-500"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] tracking-wider text-amber-600 mb-3">
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
                      ? "border-amber-500/50 text-amber-400 bg-amber-500/5"
                      : "border-stone-800 text-stone-500"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-stone-900/40 border border-amber-900/20 rounded-sm p-4">
            <div className="font-fraunces italic text-amber-500/80 text-sm mb-3">Tuning</div>
            <div className="space-y-3">
              {[
                { l: "情緒強度", v: 70 },
                { l: "語速", v: 50 },
                { l: "語調", v: 55 },
              ].map((s) => (
                <div key={s.l}>
                  <div className="flex justify-between mb-1.5">
                    <span className="font-serif-cn text-xs text-stone-400">{s.l}</span>
                    <span className="font-mono text-[10px] text-amber-500">{s.v}</span>
                  </div>
                  <div className="h-1 bg-stone-800 rounded-full">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${s.v}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Voice grid */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="font-fraunces italic text-amber-500/80 text-sm">
              Voices for 「羅薇」
            </div>
            <div className="font-mono text-[10px] text-stone-500 tracking-wider">
              247 VOICES · 6 SHOWING
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {voices.map((v, i) => (
              <button
                key={v.name}
                onClick={() => setSelected(i)}
                className={`group flex items-center gap-4 px-4 py-4 border rounded-sm text-left transition-all ${
                  selected === i
                    ? "border-amber-500/60 bg-amber-500/5"
                    : "border-stone-800/60 hover:border-stone-700 bg-stone-900/30"
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                    selected === i ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-stone-300"
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
                        selected === i ? "text-amber-100" : "text-stone-200"
                      }`}
                    >
                      {v.name}
                    </div>
                    <div className="font-mono text-[10px] text-stone-600 tracking-wider">
                      {v.gender} · {v.age}
                    </div>
                  </div>
                  <div className="font-fraunces italic text-stone-500 text-xs mt-1">
                    {v.emotion}
                  </div>
                  {v.playing && (
                    <div className="flex items-center gap-0.5 mt-2 h-3">
                      {[2, 4, 3, 5, 4, 6, 4, 5, 3, 4, 5, 3, 4].map((h, i) => (
                        <div
                          key={i}
                          className="w-0.5 bg-amber-500 rounded-full"
                          style={{ height: `${h * 2}px` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {selected === i && (
                  <Star className="w-4 h-4 text-amber-400" strokeWidth={2} fill="currentColor" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between bg-stone-900/30 border border-amber-900/20 rounded-sm px-5 py-3">
            <div>
              <div className="font-fraunces italic text-amber-500/80 text-xs">Selected</div>
              <div className="font-serif-cn text-stone-200 text-sm mt-0.5">
                黑髮謎語 · 神秘 · 慵懶
              </div>
            </div>
            <button
              onClick={() => setCurrent("final")}
              className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-serif-cn text-sm font-medium px-5 py-2 rounded-sm flex items-center gap-2 transition-all"
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
    <div className="px-12 py-10 fade-in">
      <div className="grid grid-cols-3 gap-8">
        {/* Player */}
        <div className="col-span-2">
          <div className="aspect-video bg-stone-950 border border-amber-900/30 rounded-sm overflow-hidden relative">
            <div className="absolute inset-0 bg-img-3" />
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/20 to-stone-950/40" />
            <div className="absolute inset-0 flex items-center justify-center">
              <button className="w-20 h-20 rounded-full bg-amber-500 hover:bg-amber-400 flex items-center justify-center transition-all pulse-amber">
                <Play
                  className="w-9 h-9 text-stone-950 ml-1"
                  strokeWidth={2}
                  fill="currentColor"
                />
              </button>
            </div>
            <div className="absolute top-4 left-4 font-mono text-[10px] tracking-[0.3em] text-amber-300/80">
              EP 01 · OPENING SEQUENCE
            </div>
            <div className="absolute bottom-4 left-4 right-4">
              <div className="font-display italic text-3xl text-amber-100">
                黑髮魔女她富可敵國
              </div>
              <div className="font-fraunces italic text-stone-400 text-sm mt-1">
                Episode One · The Awakening
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-5 bg-stone-900/40 border border-stone-800/60 rounded-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-fraunces italic text-amber-500/80 text-sm">Timeline</div>
              <div className="font-mono text-[10px] text-stone-500 tracking-wider">
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
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/40 to-transparent" />
                  <div className="absolute bottom-0.5 left-0.5 font-mono text-[8px] text-stone-200">
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
                    className="flex-1 bg-amber-500/40 rounded-full"
                    style={{ height: `${h * 1.5}px` }}
                  />
                )
              )}
            </div>
          </div>
        </div>

        {/* Stats & export */}
        <div className="col-span-1 space-y-5">
          <div className="bg-stone-900/40 border border-amber-900/20 rounded-sm p-5">
            <div className="font-fraunces italic text-amber-500/80 text-sm mb-4">Sheet</div>
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
                  className="flex justify-between border-b border-stone-800/50 pb-2 last:border-0"
                >
                  <dt className="font-serif-cn text-stone-400 text-sm">{row.k}</dt>
                  <dd className="font-mono text-stone-200 text-xs tracking-wider self-end">
                    {row.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <button className="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-serif-cn text-base font-medium py-3 rounded-sm flex items-center justify-center gap-2 transition-all">
            <Download className="w-4 h-4" strokeWidth={2} />
            匯出 MP4 · 1080P
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button className="bg-stone-900/40 border border-stone-800 hover:border-amber-500/40 text-stone-300 font-serif-cn text-xs py-2.5 rounded-sm transition-all">
              下載分鏡素材
            </button>
            <button className="bg-stone-900/40 border border-stone-800 hover:border-amber-500/40 text-stone-300 font-serif-cn text-xs py-2.5 rounded-sm transition-all">
              查看劇本
            </button>
          </div>

          <div className="bg-gradient-to-br from-amber-500/5 to-rose-900/10 border border-amber-500/20 rounded-sm p-4">
            <div className="font-fraunces italic text-amber-400 text-sm">
              From spark to screen.
            </div>
            <div className="font-serif-cn text-stone-300 text-xs mt-2 leading-relaxed">
              一句話到成片,21 分鐘。
              <br />
              版權歸你,免費商用。
            </div>
            <button
              onClick={() => setCurrent("home")}
              className="mt-4 font-fraunces italic text-amber-400 text-xs hover:gap-2 flex items-center gap-1 transition-all"
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
      <style>{fontStyle}</style>
      <div className="font-body bg-stone-950 text-stone-200 grain min-h-screen flex">
        <Sidebar current={current} setCurrent={setCurrent} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <TopBar current={current} />
          <div className="flex-1 overflow-y-auto">{renderPage()}</div>
        </main>
      </div>
    </>
  );
}
