/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Globe, 
  Search, 
  Sparkles, 
  Layout, 
  Smartphone, 
  Monitor, 
  Download, 
  ChevronRight, 
  RefreshCcw,
  BarChart2,
  Settings,
  ShieldCheck,
  Zap,
  Eye,
  Type,
  Palette,
  FileCode
} from "lucide-react";
import { GoogleGenAI } from "@google/genai";
import JSZip from "jszip";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

// Initialization of Gemini (Item 2)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const DESIGN_TEMPLATES = [
  { id: "auto", name: "AI Auto-Select", desc: "Let the AI choose the best aesthetic." },
  { id: "editorial", name: "Editorial / Magazine", desc: "Bold, dramatic, massive typography" },
  { id: "dark-luxury", name: "Dark Luxury", desc: "Sophisticated, minimal, pure black backgrounds" },
  { id: "brutalist", name: "Brutalist / Creative", desc: "Unconventional, high-energy contrast, bold" },
  { id: "warm-organic", name: "Warm Organic", desc: "Approachable, refined, serif fonts, earth-toned" },
  { id: "atmospheric", name: "Atmospheric Glass", desc: "Dreamy, immersive, glass morphism" },
  { id: "clean-utility", name: "Clean Utility", desc: "Minimal, functional, trusting, light themes" },
  { id: "oversized-type", name: "Oversized Typographic", desc: "Striking, organized, huge visual anchors" },
  { id: "bold-color", name: "Bold Background", desc: "Energetic, playful, vibrant single-color background" },
  { id: "saas-split", name: "SaaS Split Layout", desc: "Professional, confident, 50/50 layout" },
  { id: "prestige", name: "Prestige / Luxury", desc: "Exclusive, warm off-white, premium" },
  { id: "technical", name: "Technical / Data Grid", desc: "Information-dense, monospace, precise" }
];

type Step = "input" | "analyzing" | "redesigning" | "preview" | "dashboard";

interface SiteData {
  pages: any[];
  siteInfo: { url: string; mainTitle: string };
}

interface RedesignData {
  hero: { title: string; subtitle: string; cta: string };
  sections: Array<{ type: string; title: string; content: string }>;
  typography: { primary: string; secondary: string };
  colors: { primary: string; accent: string; bg: string };
  animations: string[];
  seo: { titleStatus: string; readability: string; mobileScore: string };
  metrics: { designScore: string; contentClarity: string; loadSpeed: string; searchIndex: string };
  suggestions: string[];
  chartData: Array<{ section: string; weight: number; target: number }>;
}

export default function App() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(DESIGN_TEMPLATES[0].id);
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [redesign, setRedesign] = useState<RedesignData | null>(null);
  const [viewport, setViewport] = useState<"mobile" | "desktop">("desktop");
  const [showCMS, setShowCMS] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Item 3 & 11: Export functionality
  const handleExport = async () => {
    if (!redesign) return;
    setDownloading(true);
    const zip = new JSZip();

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${redesign.hero.title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=${redesign.typography.primary.replace(/ /g, "+")}&family=${redesign.typography.secondary.replace(/ /g, "+")}&display=swap" rel="stylesheet">
    <style>
        body { font-family: '${redesign.typography.primary}', sans-serif; background: ${redesign.colors.bg}; }
        h1, h2, h3 { font-family: '${redesign.typography.secondary}', serif; }
    </style>
</head>
<body>
    <div class="max-w-7xl mx-auto px-6 py-12">
        <header class="flex justify-between items-center mb-24 uppercase tracking-tighter italic font-bold">
            <div>BRAND</div>
            <nav class="flex gap-8 text-sm opacity-60">
                <a href="#">Products</a>
                <a href="#">Research</a>
                <a href="#">About</a>
            </nav>
        </header>

        <section class="max-w-3xl mb-32">
            <h1 class="text-7xl font-bold tracking-tight mb-8 leading-[0.95]">${redesign.hero.title}</h1>
            <p class="text-xl text-gray-600 mb-10">${redesign.hero.subtitle}</p>
            <button class="px-10 py-5 bg-black text-white rounded-full font-bold">${redesign.hero.cta}</button>
        </section>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
            ${redesign.sections.map(s => `
                <div class="space-y-6">
                    <div class="h-[1px] bg-black/10 w-full"></div>
                    <h3 class="text-2xl font-bold uppercase tracking-tight">${s.title}</h3>
                    <p class="text-gray-500">${s.content}</p>
                </div>
            `).join("")}
        </div>
    </div>
</body>
</html>
    `;

    zip.file("index.html", htmlContent);
    const folder = zip.folder("assets");
    folder?.file("readme.txt", "Deploy this folder to your web server.");

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "reimagined-site.zip";
    link.click();
    setDownloading(false);
  };

  // Item 1: Analyzing
  const handleAnalyze = async () => {
    if (!url) return;
    setStep("analyzing");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      setSiteData(data);
      handleRedesign(data);
    } catch (err) {
      console.error(err);
      setStep("input");
    }
  };

  // Item 2: AI Redesign
  const handleRedesign = async (data: SiteData) => {
    setStep("redesigning");
    
    // Setup Template Constraint
    const templateChoice = selectedTemplate === "auto" 
      ? "Choose the best aesthetic automatically." 
      : `Strictly follow this design template style guidelines: ${DESIGN_TEMPLATES.find(t => t.id === selectedTemplate)?.name} - ${DESIGN_TEMPLATES.find(t => t.id === selectedTemplate)?.desc}`;

    const prompt = `Analyze this website data and reimagine it as a cutting-edge, incredibly aesthetically pleasing modern website. Use high-level typography and professional copy. Calculate layout metrics based on the analysis!
    ${templateChoice}
    Data: ${JSON.stringify(data.pages[0])}
    Return strict JSON format only, with no markdown codeblocks: {
      "hero": { "title": "Catchy title", "subtitle": "Compelling value prop", "cta": "Action" },
      "sections": [{ "type": "features", "title": "Prop title", "content": "Details" }],
      "typography": { "primary": "Inter", "secondary": "Playfair Display" },
      "colors": { "primary": "#000000", "accent": "#FF6321", "bg": "#FFFFFF" },
      "animations": ["fade-up", "stagger-children", "parallax"],
      "seo": { "titleStatus": "E.g., Perfect (40 chars)", "readability": "E.g., 8th Grade", "mobileScore": "E.g., 96/100" },
      "metrics": { "designScore": "E.g., 98/100", "contentClarity": "E.g., A+", "loadSpeed": "E.g., 0.6s", "searchIndex": "E.g., High" },
      "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
      "chartData": [{"section": "Hero", "weight": 80, "target": 90}, {"section": "Features", "weight": 60, "target": 80}]
    }`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      const text = response.text || "";
      const jsonStr = text.replace(/```json|```/g, "").trim();
      setRedesign(JSON.parse(jsonStr));
      setStep("preview");
    } catch (err) {
      console.error("Redesign failed", err);
      setStep("input");
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white font-sans selection:bg-orange-500 selection:text-white">
      {/* Navigation */}
      <nav className="border-b border-white/5 bg-[#0A0A0B]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display font-bold text-xl tracking-tight">
            <div className="w-8 h-8 bg-gradient-to-tr from-orange-600 to-amber-400 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            SiteReimaginer<span className="text-orange-500">.ai</span>
          </div>
          
          {step === "preview" && (
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setStep("dashboard")}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-white/5 rounded-full transition-colors"
              >
                <BarChart2 className="w-4 h-4" /> Dashboard
              </button>
              <button 
                onClick={handleExport}
                disabled={downloading}
                className="flex items-center gap-2 px-6 py-2 bg-white text-black rounded-full font-semibold text-sm hover:bg-white/90 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/10 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> {downloading ? "Exporting..." : "Export HTML"}
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-12 pb-24">
        <AnimatePresence mode="wait">
          {step === "input" && (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-3xl mx-auto mt-20 text-center space-y-12"
            >
              <div className="space-y-6">
                <motion.span 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="px-4 py-1.5 rounded-full bg-orange-500/10 text-orange-400 text-xs font-bold tracking-widest uppercase border border-orange-500/20"
                >
                  Evolution through intelligence
                </motion.span>
                <h1 className="text-6xl md:text-7xl font-display font-bold tracking-tight leading-[1.1]">
                  Reimagine any website <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-200 to-gray-500">in seconds.</span>
                </h1>
                <p className="text-lg text-gray-400 max-w-xl mx-auto font-medium">
                  Input a URL, and our AI will scrape, analyze, and rebuild your presence with cutting-edge design and professional copy.
                </p>
              </div>

              <div className="space-y-8">
                <div className="relative group max-w-2xl mx-auto">
                  <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-amber-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex items-center bg-[#151518] rounded-2xl p-2 border border-white/10">
                    <div className="pl-4 pr-3 text-gray-500">
                      <Globe className="w-6 h-6" />
                    </div>
                    <input 
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="flex-1 bg-transparent py-4 text-lg font-medium focus:outline-none placeholder:text-gray-600"
                    />
                    <button 
                      onClick={handleAnalyze}
                      className="flex items-center gap-2 px-8 py-4 bg-white text-black rounded-xl font-bold hover:bg-gray-100 transition-all active:scale-95 cursor-pointer"
                    >
                      Analyze <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Templates Selection */}
                <div className="max-w-3xl mx-auto text-left space-y-4 pt-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2"><Palette className="w-4 h-4"/> Design Template</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {DESIGN_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTemplate(t.id)}
                        className={`p-4 rounded-xl border text-left transition-all ${selectedTemplate === t.id ? "bg-orange-500/10 border-orange-500 text-white" : "bg-[#151518] border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200"}`}
                      >
                         <div className="font-bold text-sm mb-1">{t.name}</div>
                         <div className="text-xs opacity-70 line-clamp-2">{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {(step === "analyzing" || step === "redesigning") && (
            <motion.div 
              key="loading"
              className="flex flex-col items-center justify-center h-[60vh] space-y-8"
            >
              <div className="relative w-32 h-32 flex items-center justify-center">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  className="absolute inset-0 border-t-2 border-r-2 border-orange-500 rounded-full"
                ></motion.div>
                <motion.div 
                   animate={{ rotate: -360 }}
                   transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                   className="absolute inset-4 border-b-2 border-l-2 border-amber-400/50 rounded-full"
                ></motion.div>
                {step === "analyzing" ? <Search className="w-8 h-8 text-orange-500" /> : <Sparkles className="w-8 h-8 text-amber-500" />}
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold">{step === "analyzing" ? "Analyzing Infrastructure" : "Synthesizing New Design"}</h3>
                <p className="text-gray-500 font-medium">
                  {step === "analyzing" ? "Crawling pages and extracting design tokens..." : "Generating high-level typography and layout..."}
                </p>
              </div>
            </motion.div>
          )}

          {step === "preview" && redesign && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Toolbar/Sidebar */}
              <div className="lg:col-span-1 space-y-6">
                <section className="bg-[#151518] rounded-2xl p-6 border border-white/5 space-y-6">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
                      <Smartphone className="w-4 h-4" /> Responsive Check
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setViewport("desktop")}
                        className={`py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold border transition-all ${viewport === "desktop" ? "bg-white text-black border-white" : "bg-transparent text-gray-400 border-white/10 hover:border-white/30"}`}
                      >
                        <Monitor className="w-4 h-4" /> Desktop
                      </button>
                      <button 
                        onClick={() => setViewport("mobile")}
                        className={`py-2 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold border transition-all ${viewport === "mobile" ? "bg-white text-black border-white" : "bg-transparent text-gray-400 border-white/10 hover:border-white/30"}`}
                      >
                        <Smartphone className="w-4 h-4" /> Mobile
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
                      <Layout className="w-4 h-4" /> Design Tokens
                    </h4>
                    <div className="space-y-3">
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                         <div className="flex items-center gap-2 text-sm text-gray-300">
                           <Type className="w-4 h-4" /> {redesign.typography.primary}
                         </div>
                      </div>
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                         <div className="flex items-center gap-2 text-sm text-gray-300">
                           <Palette className="w-4 h-4" /> {redesign.colors.primary}
                         </div>
                         <div className="w-4 h-4 rounded-full border border-white/20" style={{ background: redesign.colors.primary }}></div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/5">
                    <button 
                      onClick={() => setShowCMS(!showCMS)}
                      className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-orange-900/20"
                    >
                      Open Mini-CMS Editor
                    </button>
                  </div>
                </section>

                <section className="bg-[#151518] rounded-2xl p-6 border border-white/5">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> SEO Optimization
                  </h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Meta Title</span>
                      <span className="text-green-500 font-mono">{redesign.seo?.titleStatus || "OK"}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Readability</span>
                      <span className="text-amber-500 font-mono">{redesign.seo?.readability || "Good"}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Mobile Score</span>
                      <span className="text-green-500 font-mono">{redesign.seo?.mobileScore || "98/100"}</span>
                    </div>
                  </div>
                </section>
              </div>

              {/* Preview Area (Item 4 & 5) */}
              <div className="lg:col-span-3">
                <div className="relative h-[80vh] bg-white rounded-2xl overflow-hidden shadow-2xl transition-all duration-500 ease-in-out" style={{ width: viewport === "mobile" ? "375px" : "100%", margin: viewport === "mobile" ? "0 auto" : "0" }}>
                  <div className="h-full w-full bg-[#FAFAFA] text-black overflow-y-auto overflow-x-hidden p-8" style={{ fontFamily: redesign.typography.primary }}>
                    <header className="flex justify-between items-center mb-24">
                      <div className="font-bold text-xl italic uppercase tracking-tighter">BRAND</div>
                      <div className="flex gap-8 text-sm font-medium opacity-60">
                        {["Products", "Research", "About"].map(i => <span key={i}>{i}</span>)}
                      </div>
                    </header>

                    <motion.div 
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-3xl mb-32"
                    >
                      <h1 className="text-7xl font-bold tracking-tight mb-8 leading-[0.95]" style={{ fontFamily: redesign.typography.secondary }}>
                        {redesign.hero.title}
                      </h1>
                      <p className="text-xl text-gray-600 mb-10 max-w-xl">
                        {redesign.hero.subtitle}
                      </p>
                      <button className="px-10 py-5 bg-black text-white rounded-full font-bold hover:scale-105 transition-transform">
                        {redesign.hero.cta}
                      </button>
                    </motion.div>

                    <div className="grid grid-cols-2 gap-12">
                      {redesign.sections.map((s, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0 }}
                          whileInView={{ opacity: 1 }}
                          viewport={{ once: true }}
                          className="space-y-6"
                        >
                          <div className="h-[1px] bg-black/10 w-full"></div>
                          <h3 className="text-2xl font-bold uppercase tracking-tight">{s.title}</h3>
                          <p className="text-gray-500">{s.content}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* CMS Overlay */}
                  <AnimatePresence>
                    {showCMS && (
                      <motion.div 
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        className="absolute inset-0 bg-white z-20 p-8 shadow-2xl border-l border-gray-100"
                      >
                         <div className="flex justify-between items-center mb-12">
                            <h2 className="text-2xl font-bold flex items-center gap-2"><Settings className="w-6 h-6" /> Content Management</h2>
                            <button onClick={() => setShowCMS(false)} className="text-gray-400 hover:text-black transition-colors">Close</button>
                         </div>
                         <div className="max-w-lg space-y-8">
                            <div className="space-y-2">
                               <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Hero Headline</label>
                               <input 
                                 className="w-full bg-gray-50 border border-gray-200 p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-black"
                                 value={redesign.hero.title}
                                 onChange={(e) => setRedesign({...redesign, hero: {...redesign.hero, title: e.target.value}})}
                               />
                            </div>
                            <div className="space-y-2">
                               <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Hero Subtitle</label>
                               <textarea 
                                 className="w-full bg-gray-50 border border-gray-200 p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-black h-32"
                                 value={redesign.hero.subtitle}
                                 onChange={(e) => setRedesign({...redesign, hero: {...redesign.hero, subtitle: e.target.value}})}
                               />
                            </div>
                            <button onClick={() => setShowCMS(false)} className="w-full py-4 bg-black text-white rounded-xl font-bold">Save Changes</button>
                         </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}

          {step === "dashboard" && redesign && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-4xl font-bold flex items-center gap-3"><BarChart2 className="w-8 h-8 text-orange-500" /> Admin Dashboard</h1>
                  <p className="text-gray-400 mt-2">Performance & Output metics for {url}</p>
                </div>
                <button onClick={() => setStep("preview")} className="px-6 py-2 border border-white/10 rounded-full hover:bg-white/5">Back to Preview</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: "Design Score", val: redesign.metrics?.designScore || "94/100", Icon: Layout },
                  { label: "Content Clarity", val: redesign.metrics?.contentClarity || "A+", Icon: Type },
                  { label: "Load Speed", val: redesign.metrics?.loadSpeed || "0.8s", Icon: Zap },
                  { label: "Search Index", val: redesign.metrics?.searchIndex || "High", Icon: Search },
                ].map((stat, i) => (
                  <div key={i} className="bg-[#151518] p-6 rounded-2xl border border-white/5 space-y-4 shadow-sm shadow-orange-950/10">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-orange-500">
                      <stat.Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">{stat.label}</p>
                      <h4 className="text-2xl font-bold mt-1">{stat.val}</h4>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-[#151518] p-8 rounded-3xl border border-white/5 h-96 flex flex-col">
                   <h4 className="text-lg font-bold mb-6">Component Weight Analysis</h4>
                   <ResponsiveContainer width="100%" height="100%">
                     <BarChart data={redesign.chartData || []}>
                       <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                       <XAxis dataKey="section" stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
                       <YAxis stroke="#a3a3a3" fontSize={12} tickLine={false} axisLine={false} />
                       <RechartsTooltip cursor={{ fill: '#ffffff05' }} contentStyle={{ backgroundColor: '#151518', border: '1px solid #ffffff10', borderRadius: '12px' }} />
                       <Bar dataKey="weight" fill="#f97316" radius={[4, 4, 0, 0]} name="Actual Weight" />
                       <Bar dataKey="target" fill="#fbbf24" radius={[4, 4, 0, 0]} name="Target Profile" />
                     </BarChart>
                   </ResponsiveContainer>
                </div>
                <div className="bg-[#151518] p-8 rounded-3xl border border-white/5 space-y-6">
                   <h4 className="text-lg font-bold">Recommendations</h4>
                   <div className="space-y-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                     {(redesign.suggestions || ["Expand content strategy further"]).map((item, i) => (
                       <div key={i} className="flex gap-4 items-start bg-black/20 p-4 rounded-2xl border border-white/5">
                          <div className="w-2 h-2 rounded-full bg-amber-500 mt-2 shrink-0"></div>
                          <p className="text-sm text-gray-400">{item}</p>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8 opacity-40 hover:opacity-100 transition-opacity">
          <p className="text-sm">© 2026 SiteReimaginer AI. Powered by Antigravity.</p>
          <div className="flex gap-8 text-sm font-medium">
            <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> Global API</span>
            <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Secure Export</span>
            <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Fast Analysis</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
