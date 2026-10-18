'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Copy, Download, FileCode2, FolderOpen, Grid2X2, Heart, History, KeyRound, Layers2, LoaderCircle, Maximize2, Moon, PanelLeftClose, PanelLeftOpen, Plus, PenTool, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Trash2, Upload, WandSparkles, X } from 'lucide-react';
import { DEFAULT_STANDARDS, createDemoCandidates, createSampleSet, sanitizeSvg, recolorSvg, updateSvgStrokeWidth, analyzeSvg, exportSvg, exportSet } from '@/lib/icon-engine';
import type { Candidate, IconItem, Standards } from '@/lib/icon-types';
import { directionCount, directionLetter, versionLabel, candidateFileName } from '@/lib/candidate-versions';
import '@/components/treatment-settings.css';
import type { GenerationResult } from '@/lib/ai';
import { selectFamilyReferences } from '@/lib/ai-references';
import VectorEditor from '@/components/vector-editor';
import { type Creativity } from '@/components/creative-direction';
import '@/components/workspace-mode.css';
import '@/components/sidebar-collapse.css';
import '@/components/connection-settings.css';
import IconSetBoard from '@/components/icon-set-board';
import SetToolbar from '@/components/set-toolbar';
import GenerationProgress from '@/components/generation-progress';
import { renderReferenceImages } from '@/lib/render-reference';
import IconPreview from '@/components/icon-preview';
import IconMetrics from '@/components/icon-metrics';
import { GRID_LABELS } from '@/lib/construction-grid';
import { applyEditableCorners } from '@/lib/editable-corners';
import { getSvgCanvas } from '@/lib/svg-preview-space';
import { fitSvgToGrid } from '@/lib/fit-icon-to-grid';
import { resolveArtworkFit } from '@/lib/artwork-fit';
import { loadPaper } from '@/lib/load-paper';
import StudioSelect from '@/components/studio-select';
import StandardsControls from '@/components/standards-controls';
import { normalizePalette } from '@/lib/color-palette';
import '@/components/design-system.css';
import '@/components/navigation-theme.css';

type Revision = { round: number; candidates: Candidate[]; standards: Standards; feedback: string; brief?:string; analysis?:StudioItem['analysis']; suggestions?:string[] };
type StudioItem = IconItem & { revisions?: Revision[]; standards?: Standards; suggestions?: string[]; analysis?: {meaning:string;visualNotes:string;designIntent:string} };
type Tab = 'studio' | 'refactor' | 'collection';
const STORAGE_KEY = 'iconify.workspace.v1';
const uid = () => crypto.randomUUID();
const standardsWith = (current:Standards,patch:Partial<Standards>):Standards => {
  const next={...current,...patch};
  if(next.colorMode==='duo')next.colorMode='color';
  if(next.palette){next.palette=normalizePalette(next.palette);next.primaryColor=next.palette[0].color;next.secondaryColor=next.palette[1]?.color??next.primaryColor;}
  return {...next,cornerRadius:Math.min(next.cornerRadius??1,next.gridSize/2),padding:Math.min(next.padding,Math.floor(Math.min(6,next.gridSize/3)*2)/2),minSpacing:Math.min(next.minSpacing??1,next.gridSize/4)};
};


function SvgPreview({ svg, size = 56, standards, showGuides }: { svg?: string; size?: number; standards?:Standards; showGuides?:boolean }) {
  if (!svg) return <Grid2X2 size={size} strokeWidth={1.5} />;
  return <IconPreview svg={svg} size={size} standards={standards} showGuides={showGuides}/>;
}
function Logo() { return <span className="logo-mark"><i /><i /><i /><i /></span>; }

export default function Home() {
  const [items, setItems] = useState<StudioItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [standards, setStandards] = useState<Standards>({ ...DEFAULT_STANDARDS });
  const [setName, setSetName] = useState('Everyday essentials');
  const [tab, setTab] = useState<Tab>('studio');
  const [brief, setBrief] = useState('');
  const [newBrief, setNewBrief] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState('');
  const [requestProgress, setRequestProgress] = useState({name:'',phase:'',startedAt:0});
  const [batchProgress, setBatchProgress] = useState({done:0,total:0});
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [batchFeedback, setBatchFeedback] = useState('');
  const [creativity, setCreativity] = useState<Creativity>('radical');
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchStates, setBatchStates] = useState<Record<string, 'working' | 'done' | 'failed'>>({});
  const [modal, setModal] = useState<'connect' | 'help' | 'history' | null>(null);
  const [inspect, setInspect] = useState<Candidate | null>(null);
  const [fitFeedback, setFitFeedback] = useState<{candidateId?:string;error:boolean;message:string}|null>(null);
  const [editing, setEditing] = useState<{itemId:string;candidate:Candidate}|null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [rememberKey, setRememberKey] = useState(false);
  const [rememberAvailable, setRememberAvailable] = useState(false);
  const [forgettingKey, setForgettingKey] = useState(false);
  const [model, setModel] = useState('');
  const [useAI, setUseAI] = useState(false);
  const [darkCanvas, setDarkCanvas] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showConstructionGuides, setShowConstructionGuides] = useState(true);
  const [size, setSize] = useState(64);
  const [dragOver, setDragOver] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'icons' | 'standards' | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [presets, setPresets] = useState<{name:string;standards:Standards}[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const collapseSidebarRef = useRef<HTMLButtonElement>(null);
  const expandSidebarRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strokeUpdate = useRef(0);
  const active = items.find(i => i.id === activeId);
  const selected = active?.candidates.filter(c => c.status === 'shortlisted') ?? [];
  const accepted = items.filter(i => i.candidates.some(c => c.status === 'accepted'));
  const acceptedSvgCount = accepted.reduce((total, item) => total + item.candidates.filter(candidate => candidate.status === 'accepted').length, 0);
  const connected = !!apiKey || keySaved || serverConfigured;
  const candidates = active?.candidates ?? [];
  const uploaded = items.filter(i=>i.originalSvg);
  const batchTargets = uploaded.filter(i=>batchIds.includes(i.id));
  const hasUpload = !isNew && !!active?.originalSvg;
  const inspectedCanvas = inspect ? getSvgCanvas(inspect.svg) : null;
  const artworkFit = resolveArtworkFit(standards);
  const artworkSpan = Number(artworkFit.extent.toFixed(2));
  const artworkPadding = Number(artworkFit.padding.toFixed(2));
  const notice = (message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); };

  useEffect(() => {
    let restored = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data.items) && data.items.length < 101 && data.standards) {
          if(!data.items.every((i:StudioItem)=>typeof i.id==='string'&&typeof i.name==='string'&&typeof i.brief==='string'&&Array.isArray(i.candidates)))throw new Error('Invalid workspace');
          const checked = data.items.map((i: StudioItem) => ({ ...i, originalSvg: i.originalSvg ? sanitizeSvg(i.originalSvg) : undefined, candidates: i.candidates.map(c => ({ ...c, svg: sanitizeSvg(c.svg) })), revisions: (i.revisions ?? []).map(r=>({...r,candidates:r.candidates.map(c=>({...c,svg:sanitizeSvg(c.svg)}))})) }));
          const uploads = checked.filter((i:StudioItem)=>i.originalSvg);
          const focused = checked.find((i:StudioItem)=>i.id===data.activeId) || uploads[0] || checked[0];
          const restoredTab:Tab = ['studio','refactor','collection'].includes(data.tab) ? data.tab : uploads.length ? 'refactor' : 'studio';
          const draft = typeof data.newBrief==='string' ? data.newBrief.slice(0,2000) : '';
          const creating = restoredTab==='studio' && (data.isNew===true || !!focused?.originalSvg);
          setItems(checked); setActiveId(focused?.id ?? ''); setNewBrief(draft); setIsNew(creating); setBrief(creating?draft:focused?.brief ?? '');
          setTab(restoredTab);
          if(['faithful','exploratory','radical'].includes(data.creativity))setCreativity(data.creativity);
          if(Number.isInteger(data.count)&&data.count>=4&&data.count<=8)setCount(data.count);
          if(typeof data.showConstructionGuides==='boolean')setShowConstructionGuides(data.showConstructionGuides);
          if(typeof data.sidebarCollapsed==='boolean')setSidebarCollapsed(data.sidebarCollapsed);
          if(typeof data.batchFeedback==='string')setBatchFeedback(data.batchFeedback.slice(0,1000));
          if(typeof data.model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(data.model))setModel(data.model);
          setBatchIds(Array.isArray(data.batchIds)?data.batchIds.filter((id:string)=>uploads.some((i:StudioItem)=>i.id===id)):uploads.map((i:StudioItem)=>i.id)); setStandards(standardsWith(DEFAULT_STANDARDS,{...data.standards,colorMode:data.standards.colorMode??(data.standards.style==='duotone'?'color':'mono'),style:data.standards.style==='duotone'?'filled':data.standards.style})); setSetName(data.name || 'Everyday essentials'); setPresets(data.presets ?? []); restored = true;
        } else { throw new Error('Unsupported workspace'); }
      }
    } catch { setError('The saved workspace could not be restored. A fresh sample set is ready.'); }
    if (!restored) { const initial = createSampleSet(DEFAULT_STANDARDS); setItems(initial); setActiveId(initial[0]?.id ?? ''); setBrief(initial[0]?.brief ?? ''); }
    setReady(true);
    fetch('/api/status').then(r => r.json()).then((raw) => { const d=raw as {configured?:boolean;serverConfigured?:boolean;keySaved?:boolean;rememberAvailable?:boolean;defaultModel?:string}; setServerConfigured(d.serverConfigured??!!d.configured); setKeySaved(!!d.keySaved); setRememberKey(!!d.keySaved); setRememberAvailable(!!d.rememberAvailable); setModel(current=>current || d.defaultModel || ''); if(d.configured) setUseAI(true); }).catch(() => {});
    return () => { controller.current?.abort(); connectionController.current?.abort(); if(toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, standards, name: setName, presets, activeId, tab, batchIds, creativity, count, batchFeedback, model, showConstructionGuides, newBrief, isNew, sidebarCollapsed })); }
    catch { setError('Browser storage is full or unavailable. Export your work before closing this page.'); }
  }, [items, standards, setName, ready, presets, activeId, tab, batchIds, creativity, count, batchFeedback, model, showConstructionGuides, newBrief, isNew, sidebarCollapsed]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { connectionController.current?.abort(); setModal(null); setInspect(null); setMobilePanel(null); }
    };
    window.addEventListener('keydown',handler); return()=>window.removeEventListener('keydown',handler);
  }, []);

  useEffect(() => { setFitFeedback(null); }, [inspect?.id]);

  const audit = useMemo(() => {
    if(!active || !ready) return null;
    try { return analyzeSvg(active.originalSvg || active.candidates.find(c=>c.status==='accepted')?.svg || active.candidates[0]?.svg || '', standards); } catch { return null; }
  }, [active, standards, ready]);
  useEffect(() => {
    if(!modal && !inspect) return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=dialogRef.current;
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, a[href], summary, [tabindex="0"]')??[]);
    focusable()[0]?.focus();
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const elements=focusable();const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[modal,inspect]);
  const updateStandards = async (patch: Partial<Standards>) => {
    if(busy)return;
    setStandards(s=>standardsWith(s,patch));
    if(patch.gridSize!==undefined){strokeUpdate.current++;void fitExistingDesigns(standardsWith(standards,patch));return;}
    if (patch.strokeWidth === undefined || patch.strokeWidth === standards.strokeWidth) return;
    const width = patch.strokeWidth;
    const request = ++strokeUpdate.current;
    // Junctions depend on the current painted width, including the first change
    // after a refresh when the geometry library has not been loaded yet.
    try { await loadPaper(); } catch { setError('Stroke width can update, but junction checks could not load. Refresh to retry.'); }
    if(request!==strokeUpdate.current)return;
    const adjustSvg = (svg:string) => updateSvgStrokeWidth(svg,width);
    const historyLabel = 'Before live stroke adjustment';
    // Update real SVG data so previews, editor, clipboard and exports agree. Originals and history stay intact.
    setItems(old=>old.map(item=>{
      let changed = false;
      const candidates = item.candidates.map(candidate=>{
        if (candidate.svg === item.originalSvg) return candidate;
        const svg = adjustSvg(candidate.svg);
        if (svg === candidate.svg) return candidate;
        changed = true; return {...candidate, svg};
      });
      if (!changed) return item;
      const revisions = item.revisions ?? [];
      const baseline = revisions.at(-1)?.feedback === historyLabel ? [] : [{round:item.round,candidates:item.candidates,standards:item.standards||standards,feedback:historyLabel,brief:item.brief,analysis:item.analysis,suggestions:item.suggestions}];
      return {...item,candidates,standards:{...(item.standards||standards),strokeWidth:width},revisions:[...revisions,...baseline].slice(-10)};
    }));
    setInspect(current=>current && !items.some(item=>item.originalSvg===current.svg) ? {...current,svg:adjustSvg(current.svg)} : current);
  };

  async function fitExistingDesigns(nextStandards=standards, candidateId?:string) {
    if(busy)return;
    const targets=items.filter(item=>item.candidates.some(candidate=>candidate.svg!==item.originalSvg&&(!candidateId||candidate.id===candidateId)));
    if(!targets.length)return;
    setBusy('fit');setError('');setUploadErrors([]);setFitFeedback(null);
    const aborter=new AbortController();controller.current=aborter;
    let fitted=0;const failures:string[]=[];
    try {
      for(const item of targets){
        if(aborter.signal.aborted)break;
        const replacements=new Map<string,{before:string;after:string}>();
        for(const candidate of item.candidates){
          if(aborter.signal.aborted)break;
          if(candidate.svg===item.originalSvg||(candidateId&&candidate.id!==candidateId))continue;
          try {
            const svg=sanitizeSvg(await fitSvgToGrid(candidate.svg,nextStandards));
            if(svg!==candidate.svg){replacements.set(candidate.id,{before:candidate.svg,after:svg});fitted++;}
          } catch(e){failures.push(`${item.name} / ${candidate.name}: ${e instanceof Error?e.message:'Could not fit this design.'}`);}
        }
        if(replacements.size){
          setItems(old=>old.map(current=>{
            if(current.id!==item.id)return current;
            const candidates=current.candidates.map(candidate=>{
              const replacement=replacements.get(candidate.id);
              return replacement&&candidate.svg===replacement.before?{...candidate,svg:replacement.after}:candidate;
            });
            if(!candidates.some((candidate,index)=>candidate!==current.candidates[index]))return current;
            const revision:Revision={round:current.round,candidates:current.candidates,standards:current.standards||standards,feedback:'Before fitting artwork to grid',brief:current.brief,analysis:current.analysis,suggestions:current.suggestions};
            return {...current,candidates,standards:{...(current.standards||standards),gridSize:nextStandards.gridSize,strokeWidth:nextStandards.strokeWidth,padding:nextStandards.padding,constructionGrid:nextStandards.constructionGrid},revisions:[...(current.revisions??[]),revision].slice(-10)};
          }));
          setInspect(current=>{const replacement=current&&replacements.get(current.id);return current&&replacement&&current.svg===replacement.before?{...current,svg:replacement.after}:current;});
        }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(failures.length)setUploadErrors(failures);
      const extent=Number(resolveArtworkFit(nextStandards).extent.toFixed(2));
      const message=failures.length?failures.join('\n'):fitted?`${fitted} ${fitted===1?'design':'designs'} fitted within ${extent} × ${extent} u. Previous sizes are saved in history.`:`Artwork already fits the ${extent} × ${extent} u target.`;
      setFitFeedback({candidateId,error:failures.length>0,message});
      notice(message);
    } catch(e) {
      const message=e instanceof Error?e.message:'Could not fit the artwork. Your previous design was kept.';
      setFitFeedback({candidateId,error:true,message});setError(message);
    } finally {setBusy('');controller.current=null;}
  }
  const chooseIcon = (i: StudioItem) => { setActiveId(i.id); setBrief(i.brief); setIsNew(false); setFeedback(''); setError(''); setMobilePanel(null); setTab(i.originalSvg?'refactor':'studio'); };
  const newIcon = () => { if(busy)return; setIsNew(true); setBrief(''); setNewBrief(''); setTab('studio'); setFeedback(''); setError(''); setMobilePanel(null); setTimeout(()=>briefRef.current?.focus(),50); };
  const switchWorkspace = (next:'studio'|'refactor') => {
    if(busy||tab===next)return;
    setError(''); setFeedback(''); setMobilePanel(null);
    if(next==='studio') { setIsNew(true); setBrief(newBrief); setTab('studio'); }
    else { const target=active?.originalSvg?active:uploaded[0]; if(target)chooseIcon(target); setIsNew(false); setTab('refactor'); }
  };
  const changeBrief = (value:string) => { setBrief(value); if(isNew)setNewBrief(value); };
  const toggleSidebar = () => {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    requestAnimationFrame(() => (collapsed ? expandSidebarRef : collapseSidebarRef).current?.focus());
  };

  async function generate(mode: 'create' | 'refine' | 'redesign' = 'create', itemOverride?: StudioItem) {
    const focused = itemOverride || active;
    const designBrief = itemOverride?.brief || brief;
    const shortlisted = focused?.candidates.filter(c=>c.status==='shortlisted') ?? [];
    if(busy) return;
    if((!itemOverride&&(isNew||!active))&&items.length>=100){setError('A workspace can hold up to 100 icons. Remove an icon before creating another.');return;}
    if(!designBrief.trim()) { setError('Describe what this icon should communicate first.'); briefRef.current?.focus(); return; }
    if(mode==='refine' && (directionCount(shortlisted)<2 || directionCount(shortlisted)>3)) { setError('Shortlist 2 or 3 directions to refine together.'); return; }
    if(mode==='redesign' && !focused?.originalSvg) return;
    const runAI = useAI || mode==='redesign' || mode==='refine' || standards.perspective==='isometric';
    if(runAI && !connected) { setError('Creative redesign needs a connected AI token. Your originals and previous directions are unchanged.'); setModal('connect'); return; }
    setError(''); setUploadErrors([]); setBusy(mode); controller.current = new AbortController();
    const target = itemOverride || (isNew ? undefined : active);
    const targetId = target?.id || uid();
    const nextRound = target ? target.round+1 : 1;
    if(target?.originalSvg)setBatchStates(old=>({...old,[targetId]:'working'}));
    try {
      let generated: Candidate[]; let suggestions: string[] = []; let analysis: StudioItem['analysis'];
      if(runAI) {
        setRequestProgress({name:target?.name||'New icon',phase:'Preparing reference previews',startedAt:Date.now()});
        const references = mode==='refine'?shortlisted.map(c=>c.svg):mode==='redesign'?selectFamilyReferences(focused!,items):[];
        const referenceImages = await renderReferenceImages(references);
        setRequestProgress(p=>({...p,phase:'Waiting for OpenAI'}));
        const response = await fetch('/api/generate', {method:'POST',headers:{'Content-Type':'application/json'},signal:controller.current.signal,body:JSON.stringify({brief:designBrief,standards,count,mode,creativity,feedback:mode==='redesign'?batchFeedback:feedback,references,referenceImages,apiKey:apiKey||undefined,model:model||undefined})});
        const data = await response.json() as GenerationResult & {error?:string|{message?:string}}; if(!response.ok) throw new Error(typeof data.error==='string'?data.error:data.error?.message||'Generation failed. Please try again.');
        if(!Array.isArray(data.candidates)||data.candidates.length!==(standards.style==='both'?count*2:count)) throw new Error('AI returned an incomplete set. Your previous round is safe; please try again.');
        setConnectionVerified(true); setRequestProgress(p=>({...p,phase:'Checking the SVG designs'}));
        generated = data.candidates.map(c=>({...c,id:uid(),svg:sanitizeSvg(c.svg),status:'pending' as const,source:'ai' as const}));
        suggestions = Array.isArray(data.suggestions)?data.suggestions:[]; analysis=data.analysis;
      } else {
        await new Promise(r=>setTimeout(r,450));
        if(controller.current.signal.aborted) throw new DOMException('Cancelled','AbortError');
        generated = createDemoCandidates(designBrief,standards,count,nextRound);
        suggestions=['These are handcrafted demo samples. Connect AI for custom concepts and creative redesign.'];
      }
      generated = await Promise.all(generated.map(async candidate => ({ ...candidate, svg: sanitizeSvg(await applyEditableCorners(candidate.svg, standards)) })));
      if(controller.current.signal.aborted) throw new DOMException('Cancelled','AbortError');
      const revision:Revision|undefined=target?{round:target.round,candidates:target.candidates,standards:target.standards||standards,feedback,brief:target.brief,analysis:target.analysis,suggestions:target.suggestions}:undefined;
      const item:StudioItem={...target,id:targetId,name:target?.name || designBrief.trim().split(/[.!?\n]/)[0].split(' ').slice(0,5).join(' '),brief:designBrief.trim(),candidates:generated,round:nextRound,standards:{...standards},suggestions,analysis,revisions:[...(target?.revisions??[]),...(revision?[revision]:[])].slice(-10)};
      setItems(old=>target?old.map(i=>i.id===targetId?item:i):[...old,item]); setActiveId(targetId); setBrief(designBrief.trim()); if(target?.originalSvg)setBatchStates(old=>({...old,[targetId]:'done'})); setIsNew(false); if(!target)setNewBrief(''); setFeedback(''); setTab(target?.originalSvg?'refactor':'studio'); notice(`${directionCount(generated)} ${standards.style==='both'?'paired ':''}${runAI?'AI':'demo'} directions are ready for ${item.name}.`);
    } catch(e) { if(target?.originalSvg)setBatchStates(old=>({...old,[targetId]:'failed'})); if(e instanceof Error && e.name==='AbortError') notice('Generation cancelled. Your previous round is safe.'); else setError(e instanceof Error?e.message:'Something went wrong. Please try again.'); }
    finally { setBusy(''); controller.current=null; setBatchStates(old=>Object.fromEntries(Object.entries(old).filter(([,state])=>state!=='working'))); }
  }

  async function refactorUploadedSet() {
    if(busy||!batchTargets.length)return;
    if(!connected){setError('Connect AI to creatively redesign your selected icons. Your uploaded set is preserved.');setModal('connect');return;}
    setUseAI(true);setError('');setUploadErrors([]);setBusy('batch');setBatchProgress({done:0,total:batchTargets.length});setBatchStates({});
    const aborter=new AbortController();controller.current=aborter;
    const failures:string[]=[];let completed=0;
    for(const item of batchTargets){
      if(aborter.signal.aborted)break;
      setBatchStates(old=>({...old,[item.id]:'working'}));
      setRequestProgress({name:item.name,phase:'Preparing reference previews',startedAt:Date.now()});
      try {
        const references=selectFamilyReferences(item,items);
        const referenceImages=await renderReferenceImages(references);
        setRequestProgress(p=>({...p,phase:'Waiting for OpenAI'}));
        const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:aborter.signal,body:JSON.stringify({brief:item.brief,standards,count,mode:'redesign',creativity,references,referenceImages,feedback:batchFeedback.trim()||'Creatively redesign this icon. Preserve its meaning, rethink the geometry and make it belong to the shared visual family.',apiKey:apiKey||undefined,model:model||undefined})});
        const data=await response.json() as GenerationResult&{error?:string|{message?:string};code?:string};
        if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:data.error?.message||'Generation failed.'),{code:data.code});
        if(!Array.isArray(data.candidates)||data.candidates.length!==(standards.style==='both'?count*2:count))throw new Error('Incomplete alternatives returned.');
        setConnectionVerified(true);setRequestProgress(p=>({...p,phase:'Checking the SVG designs'}));
        const generated:Candidate[]=await Promise.all(data.candidates.map(async c=>({...c,id:uid(),svg:sanitizeSvg(await applyEditableCorners(sanitizeSvg(c.svg),standards)),status:'pending' as const,source:'ai' as const})));
        if(aborter.signal.aborted)break;
        setItems(old=>old.map(i=>i.id!==item.id?i:{...i,candidates:generated,round:i.round+1,standards:{...standards},suggestions:data.suggestions,analysis:data.analysis,revisions:[...(i.revisions??[]),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Before creative redesign',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}].slice(-10)}));completed++;
        setBatchStates(old=>({...old,[item.id]:'done'}));
      }catch(e){
        if(aborter.signal.aborted)break;
        setBatchStates(old=>({...old,[item.id]:'failed'}));
        const code=(e as {code?:string})?.code;
        if(code&&['network_error','server_dns_error','server_network_blocked','invalid_api_key','provider_access_denied','model_unavailable','provider_rate_limit','provider_request_rejected','provider_unavailable'].includes(code)){
          setError(`${e instanceof Error?e.message:'Connection failed.'} Batch stopped; your icons are preserved.`);break;
        }
        failures.push(`${item.name}: ${e instanceof Error?e.message:'Could not redesign.'}`);
      }
      setBatchProgress(p=>({...p,done:p.done+1}));
    }
    setBusy('');controller.current=null;setBatchStates(old=>Object.fromEntries(Object.entries(old).filter(([,state])=>state!=='working')));
    if(failures.length)setUploadErrors(failures);
    notice(`${completed} of ${batchTargets.length} icons redesigned.${aborter.signal.aborted?' Cancelled; completed work was kept.':' Select any icon to review its alternatives.'}`);
  }

  async function connectAI() {
    if(connectionBusy)return;
    setConnectionBusy(true);setConnectionError('');
    const aborter=new AbortController();connectionController.current=aborter;let verificationTimedOut=false;const timeout=setTimeout(()=>{verificationTimedOut=true;aborter.abort();},20_000);
    try {
      const response=await fetch('/api/connection',{method:'POST',headers:{'Content-Type':'application/json'},signal:aborter.signal,body:JSON.stringify({apiKey:keyDraft.trim()||apiKey||undefined,model:model||undefined,remember:rememberKey})});
      const data=await response.json() as {verified?:boolean;model?:string;keySaved?:boolean;error?:string};
      if(!response.ok||!data.verified)throw new Error(data.error||'Could not verify the AI connection.');
      if(aborter.signal.aborted)return;
      setKeySaved(!!data.keySaved);
      if(data.keySaved)setApiKey('');
      else if(keyDraft.trim())setApiKey(keyDraft.trim());
      setKeyDraft('');
      setConnectionVerified(true);setUseAI(true);setModal(null);setError('');
      notice(data.keySaved?'Key securely remembered on this browser. Refreshing will keep your connection.':`OpenAI connection verified. ${data.model||'Your model'} is ready for this session.`);
    }catch(e){if(aborter.signal.aborted&&!verificationTimedOut)return;setConnectionError(e instanceof Error&&e.name==='AbortError'?'The connection check timed out. Please try again.':e instanceof Error?e.message:'Could not verify the connection.');}
    finally{clearTimeout(timeout);if(connectionController.current===aborter){connectionController.current=null;setConnectionBusy(false);}}
  }

  async function forgetAIKey() {
    if(connectionBusy||forgettingKey)return;
    controller.current?.abort();
    connectionController.current?.abort();
    setForgettingKey(true);setConnectionError('');
    try {
      const response=await fetch('/api/connection',{method:'DELETE',signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error('Could not forget the saved key. Please try again.');
      setKeySaved(false);setRememberKey(false);setApiKey('');setKeyDraft('');setUseAI(false);setConnectionVerified(false);setModal(null);
      notice('Saved key forgotten. Demo mode is enabled.');
    }catch(e){setConnectionError(e instanceof Error?e.message:'Could not forget the saved key. Please try again.');}
    finally{setForgettingKey(false);}
  }

  function openEditor(candidate:Candidate, itemId=activeId) {
    if(!itemId||busy)return;
    setInspect(null);setModal(null);setEditing({itemId,candidate});
  }
  function saveVectorEdit(svg:string) {
    if(!editing)return;
    try{
      const safe=sanitizeSvg(svg);
      const edited:Candidate={...editing.candidate,id:uid(),svg:safe,name:editing.candidate.name.replace(/ · Edited$/,'')+' · Edited',rationale:'Manually edited with the vector tools. Review the geometry and accept when ready.',status:'pending',source:'edited'};
      setItems(old=>old.map(i=>i.id!==editing.itemId?i:{...i,round:i.round+1,candidates:i.candidates.some(c=>c.id===editing.candidate.id)?i.candidates.map(c=>c.id===editing.candidate.id?edited:c):[...i.candidates,edited],revisions:[...(i.revisions??[]),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Before vector editing',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}].slice(-10)}));
      setEditing(null);notice('Vector edit saved as a new round. Review and accept when ready.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save the edited SVG.');throw e;}
  }

  function setCandidateStatus(id:string,status:Candidate['status'],itemId=activeId) {
    const item=items.find(i=>i.id===itemId);
    if(!item || busy) return;
    const candidate=item.candidates.find(c=>c.id===id);if(!candidate)return;
    const shortlisted=item.candidates.filter(c=>c.status==='shortlisted');
    const shortlistCount=directionCount(shortlisted);
    const directionAlreadySelected=!!candidate.pairId&&shortlisted.some(c=>c.pairId===candidate.pairId);
    if(status==='shortlisted' && candidate.status!=='shortlisted' && !directionAlreadySelected && shortlistCount>=3) { notice('Choose up to 3 directions per icon.'); return; }
    setItems(old=>old.map(i=>i.id!==itemId?i:{...i,candidates:i.candidates.map(c=>c.id===id?{...c,status:c.status===status?'pending':status}:status==='accepted'&&c.status==='accepted'&&(!candidate.pairId||c.treatment===candidate.treatment||!c.pairId)?{...c,status:'pending'}:c)}));
    chooseIcon(item);
    if(status==='accepted' && candidate.status!=='accepted') notice(`${item.name}${candidate.treatment?' · '+versionLabel(candidate):''} added to your accepted collection.`);
  }

  async function upload(files:FileList|null) {
    if(!files || busy) return;
    const incoming=Array.from(files); const errors:string[]=[]; const added:StudioItem[]=[];
    if(items.length+incoming.length>100) { setError('A workspace can hold up to 100 icons. Upload a smaller set.'); return; }
    for(const file of incoming) {
      try {
        if(!file.name.toLowerCase().endsWith('.svg')) throw new Error('Only SVG files are supported.');
        if(file.size>200_000) throw new Error('SVG must be smaller than 200 KB.');
        const svg=sanitizeSvg(await file.text());
        const name=file.name.replace(/\.svg$/i,'').replace(/[-_]/g,' ');
        added.push({id:uid(),name,brief:`Refine this ${name} icon. Preserve its meaning and align it with the set.`,originalSvg:svg,candidates:[{id:uid(),name:'Original upload',svg,rationale:'Your source SVG, preserved for comparison.',status:'pending',source:'normalized'}],round:0,standards:{...standards}});
      } catch(e) { errors.push(`${file.name}: ${e instanceof Error?e.message:'Could not read SVG.'}`); }
    }
    setUploadErrors(errors);
    if(added.length) { setItems(old=>[...old,...added]); setBatchIds(old=>[...old,...added.map(i=>i.id)]); chooseIcon(added[0]); setTab('refactor'); notice(`${added.length} ${added.length===1?'icon':'icons'} imported. All uploads are visible in your set.`); }
    if(fileRef.current) fileRef.current.value='';
  }

  function applyPalette() {
    if(busy)return;
    try {
      const targets=batchTargets.filter(i=>i.round>0);
      if(!targets.length){notice('Select icons with existing alternatives to recolor.');return;}
      const updates=new Map(targets.map(i=>[i.id,{
        ...i,round:i.round+1,standards:{...(i.standards||standards),colorMode:standards.colorMode,palette:standards.palette,primaryColor:standards.primaryColor,secondaryColor:standards.secondaryColor},
        candidates:i.candidates.map(c=>({...c,id:uid(),svg:recolorSvg(c.svg,standards),status:'pending' as const,source:'edited' as const,rationale:`${c.rationale} Palette updated without changing the geometry.`})),
        analysis:i.analysis?{...i.analysis,designIntent:`Design geometry retained; palette updated to ${standards.colorMode!=='mono'?'the selected colors and proportions':'monochrome'}.`}:undefined,
        revisions:[...(i.revisions??[]),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Before changing the palette',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}].slice(-10)
      }]));
      setItems(old=>old.map(i=>updates.get(i.id)||i));notice(`Palette applied to ${targets.length} icons. Shapes and originals are preserved; review the recolored designs.`);
    }catch(e){setError(e instanceof Error?e.message:'Could not apply the palette. Previous designs are unchanged.');}
  }
  function removeIcon(id:string) {
    const rest=items.filter(i=>i.id!==id); setItems(rest); setBatchIds(old=>old.filter(value=>value!==id)); if(id===activeId){setActiveId(rest[0]?.id??'');setBrief(rest[0]?.brief??'');setIsNew(!rest.length);} notice('Icon removed from this workspace.');
  }
  function downloadSet() { if(!accepted.length){notice('Accept at least one direction to export your set.');return;} try{exportSet(accepted,standards);notice('Your accepted SVG set is ready to download.');}catch(e){setError(e instanceof Error?e.message:'Export failed.');} }
  function restoreRevision(rev:Revision) {
    if(!active)return;
    setItems(old=>old.map(i=>i.id!==active.id?i:{...i,candidates:rev.candidates,round:rev.round,standards:rev.standards,brief:rev.brief??i.brief,analysis:rev.analysis,suggestions:rev.suggestions,revisions:[...(i.revisions??[]).filter(r=>r!==rev),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Saved before restore',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}]}));setBrief(rev.brief??active.brief);setModal(null);notice(`Restored round ${rev.round}.`);
  }

  return <div className={`app-shell has-sidebar-brand ${acceptedSvgCount>0?'has-export-selection':''}`}>
    <nav className="mobile-tools"><button aria-expanded={mobilePanel==='icons'} aria-controls="workspace-sidebar" onClick={()=>setMobilePanel(mobilePanel==='icons'?null:'icons')}><Layers2 size={16}/>Your icons</button><button onClick={()=>setMobilePanel(mobilePanel==='standards'?null:'standards')}><SlidersHorizontal size={16}/>Standards</button></nav>
    <div className={`studio-layout ${sidebarCollapsed?'sidebar-collapsed':''}`}>
      {sidebarCollapsed&&<button ref={expandSidebarRef} className="sidebar-toggle sidebar-expand-button sidebar-edge-toggle" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded={false} aria-controls="workspace-sidebar" onClick={toggleSidebar}><PanelLeftOpen size={17}/></button>}
      <aside id="workspace-sidebar" aria-label="Your icons and workspace" className={`sidebar ${mobilePanel==='icons'?'mobile-open':''}`}>
        <div className="sidebar-brand-row"><a className="brand" href="/" aria-label="Iconoclast.ai home"><Logo /><span>Iconoclast<span className="brand-dot">.ai</span></span></a><button ref={collapseSidebarRef} className="sidebar-toggle sidebar-collapse-button" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={toggleSidebar}><PanelLeftClose size={17}/></button><button className="sidebar-toggle sidebar-mobile-close" aria-label="Close icons sidebar" onClick={()=>setMobilePanel(null)}><X size={18}/></button></div>
        <div className="sidebar-project"><label className="sidebar-project-name"><FolderOpen size={15}/><input value={setName} maxLength={60} onChange={e=>setSetName(e.target.value)} aria-label="Icon set name"/></label><div className="sidebar-project-meta"><span><i/>Saved on this device</span><button className="icon-button small" title="How Iconoclast.ai works" aria-label="How Iconoclast.ai works" onClick={()=>setModal('help')}><CircleHelp size={16}/></button></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Workspace views">
          <button className={tab==='studio'?'active':''} onClick={()=>switchWorkspace('studio')} disabled={!!busy}><WandSparkles size={17}/>Design new</button>
          <button className={tab==='refactor'?'active':''} onClick={()=>switchWorkspace('refactor')} disabled={!!busy}><Layers2 size={17}/>Redesign<span className="nav-badge">{uploaded.length}</span></button>
          <button className={tab==='collection'?'active':''} onClick={()=>setTab('collection')}><Grid2X2 size={17}/>Accepted icons<span className="nav-badge">{accepted.length}</span></button>
        </nav>
        <div className="icons-heading"><span>YOUR ICONS <b>{items.length}</b></span><button className="icon-button small" aria-label="Add new icon" onClick={newIcon}><Plus size={16}/></button></div>
        <div className="icon-list">{items.map(i=><div className={`icon-row ${i.id===activeId&&!isNew?'selected':''}`} key={i.id}><button className="icon-row-main" onClick={()=>chooseIcon(i)}><span className="mini-icon"><SvgPreview svg={i.candidates.find(c=>c.status==='accepted')?.svg||i.candidates[0]?.svg} size={19}/></span><span className="icon-row-label">{i.name}</span>{i.candidates.some(c=>c.status==='accepted')?<Check size={13} className="accepted-check"/>:<span className="status-dot"/>}</button><button className="delete-icon" aria-label={`Remove ${i.name}`} onClick={()=>removeIcon(i.id)} disabled={!!busy}><X size={12}/></button></div>)}</div>
        <button className="add-icon" onClick={newIcon} disabled={!!busy}><Plus size={16}/>Create an icon</button>
        <div className={`upload-zone ${dragOver?'drag-over':''}`} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);void upload(e.dataTransfer.files);}}><div className="upload-glyph"><Upload size={19}/></div><strong>Already have icons?</strong><p>Drop your SVGs here.<br/>We’ll help them belong together.</p><button className="tertiary" onClick={()=>fileRef.current?.click()} disabled={!!busy}>Browse files <ArrowRight size={13}/></button></div>
        <div className="sidebar-bottom"><button className="connection-card" onClick={()=>setModal('connect')}><span className={`connection-icon ${connected?'connected':''}`}><Sparkles size={17}/></span><span><strong>AI settings</strong><small>{connected?(useAI?'AI enabled · Manage connection':'Demo mode · Manage connection'):'Connect your API token'}</small></span><ChevronRight size={14}/></button><div className="sidebar-foot"><span>DESIGNED TO BELONG.</span><span>v0.1</span></div></div>
      </aside>

      <main className={`main-workspace ${tab==='refactor'?'set-workspace':''}`}>
        <div className="workspace-scroll">
          {tab!=='refactor'&&<div className="page-heading"><div className="eyebrow"><span/> THE ICON WORKSPACE</div><h1>{tab==='collection'?'Small icons. One voice.':isNew?'Every great icon starts here.':'One idea. Many possibilities.'}</h1><p>{tab==='collection'?'Your accepted directions, ready for their next big thing.':"Explore a few directions. Find the one that feels right."}</p></div>}

          {error&&<div className="message error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
          {uploadErrors.length>0&&<div className="message error" role="alert"><div><strong>Some icons need attention</strong>{uploadErrors.map((e,i)=><p key={i}>{e}</p>)}</div><button aria-label="Dismiss upload errors" onClick={()=>setUploadErrors([])}><X size={14}/></button></div>}

          {tab==='collection'?<>
            <div className="results-toolbar"><div><strong>{accepted.length} accepted icons</strong><span>SVG · Ready to export</span></div></div>
            {accepted.length?<div className={`candidate-grid collection-grid ${darkCanvas?'dark-canvas':''}`}>{accepted.flatMap(i=>i.candidates.filter(c=>c.status==='accepted').map(c=><article className="candidate-card" key={c.id}><button className="collection-preview" aria-label={`Open ${i.name} in studio`} onClick={()=>chooseIcon(i)}><SvgPreview svg={c.svg} size={64}/></button><div className="collection-footer"><div><strong>{i.name}</strong><small>{c.name}{c.treatment&&` · ${versionLabel(c)}`}</small></div><button className="icon-button" aria-label={`Download ${i.name} ${versionLabel(c)} SVG`} onClick={()=>exportSvg(c.svg,candidateFileName(i.name,c))}><Download size={16}/></button></div></article>))}</div>:<div className="empty-state"><CheckCheck size={36}/><h2>A collection worth keeping.</h2><p>Accept your favorite direction for each icon.<br/>They’ll be gathered here, ready to export.</p><button className="button primary" onClick={()=>setTab('studio')}>Explore your icons<ArrowRight size={15}/></button></div>}
          </>:tab==='refactor'?<>
            {uploaded.length>0?<>
              <SetToolbar total={uploaded.length} selected={batchTargets.length} count={count} onCountChange={setCount}
                brief={batchFeedback} onBriefChange={setBatchFeedback} connected={connected} busy={!!busy}
                canRecolor={batchTargets.some(i=>i.round>0)} onAddSvgs={()=>fileRef.current?.click()} onRecolor={applyPalette}
                onRedesign={refactorUploadedSet} onCancel={()=>controller.current?.abort()} onConnect={()=>setModal('connect')}
                onToggleAll={()=>setBatchIds(batchTargets.length===uploaded.length?[]:uploaded.map(i=>i.id))}
                showGuides={showConstructionGuides} onShowGuidesChange={setShowConstructionGuides}
                proportionLabel={standards.proportion==='square'?'1:1 artwork':'Natural proportions'} gridLabel={GRID_LABELS[standards.constructionGrid||'none']}/>
              {busy&&busy!=='fit'&&<GenerationProgress {...requestProgress} count={count} completed={busy==='batch'?batchProgress.done:0} total={busy==='batch'?batchProgress.total:1}/>}
              <IconSetBoard standards={standards} showGuides={showConstructionGuides} items={uploaded} selectedIds={batchIds} activeId={activeId} busy={!!busy} states={batchStates}
                onToggle={id=>setBatchIds(old=>old.includes(id)?old.filter(i=>i!==id):[...old,id])}
                onFocus={id=>{const i=items.find(i=>i.id===id);if(i)chooseIcon(i);}}
                onBriefChange={(id,value)=>{setItems(old=>old.map(i=>i.id===id?{...i,brief:value}:i));if(id===activeId)setBrief(value);}}
                onRedesign={id=>{const i=items.find(i=>i.id===id);if(i)void generate('redesign',i);}}
                onStatus={(itemId,id,status)=>setCandidateStatus(id,status,itemId)}
                onEdit={(itemId,c)=>openEditor(c,itemId)}
                onInspect={(itemId,c)=>{const i=items.find(i=>i.id===itemId);if(i)chooseIcon(i);setInspect(c);}}
                onHistory={id=>{const i=items.find(i=>i.id===id);if(i)chooseIcon(i);setModal('history');}}/>
            </>:<div className="set-upload-empty"><Upload size={28}/><h2>Bring your icon set</h2><p>Every SVG gets its own row, with the original beside its redesigns.</p><button className="button primary" onClick={()=>fileRef.current?.click()}>Upload SVGs</button></div>}
          </>:<>
            <section className="brief-card"><div className="brief-heading"><label htmlFor="icon-brief"><Sparkles size={15}/>{hasUpload?`Redesign brief · ${active?.name}`:'What should your icon communicate?'}</label><span>THE BRIEF</span></div><textarea id="icon-brief" ref={briefRef} value={brief} maxLength={2000} disabled={!!busy} onChange={e=>changeBrief(e.target.value)} placeholder="A workspace icon for a productivity app. Simple, welcoming, with a sense of structure…"/><div className="brief-bottom"><div className="direction-count"><label htmlFor="direction-count">Directions</label><StudioSelect id="direction-count" label="Directions" value={String(count)} disabled={!!busy} size="sm" onValueChange={value=>setCount(Number(value))} options={[4,5,6,7,8].map(n=>({value:String(n),label:`${n} ${standards.style==='both'?'pairs':'alternatives'}`}))}/></div>{busy?<button className="button secondary" onClick={()=>controller.current?.abort()}><LoaderCircle size={15} className="spin"/>Cancel</button>:<button className="button primary" onClick={()=>generate(hasUpload?'redesign':'create')}><Sparkles size={15}/>{hasUpload?'Redesign this icon':useAI||standards.perspective==='isometric'?'Generate alternatives':'Preview demo icons'}<span className="enter-symbol">↵</span></button>}</div></section>
            {busy&&busy!=='fit'&&(useAI||busy!=='create')&&<GenerationProgress {...requestProgress} count={count} completed={0} total={1}/>}
            <div className="demo-note"><span className={`tiny-dot ${useAI?'purple':''}`}/>{hasUpload?(connected?'AI redraws the icon’s geometry using your creative direction. The original stays available.':'Creative redesign requires AI. Connect your token to explore new geometry for each uploaded icon.'):useAI?'Your brief and references are sent to OpenAI when you generate.':'Demo samples are handcrafted. Connect AI for icons designed from your brief.'}{standards.style==='both'&&<span> Both produces {count} outlined + {count} filled SVGs in one request; more output can use more tokens.</span>}{!connected&&<button onClick={()=>setModal('connect')}>Connect AI<ArrowRight size={11}/></button>}</div>

            {!isNew&&active?.originalSvg&&<section className="audit-card"><div className="source-preview"><SvgPreview svg={active.originalSvg} size={42}/><span>ORIGINAL</span></div><div className="audit-copy"><div><strong>Consistency review</strong><span className={`score ${audit&&audit.score>=85?'good':''}`}>{audit?.score??'—'} / 100</span></div><p>{audit?.issues.length?`${audit.issues.length} points to review against your standards.`:'The source matches the measurable style checks.'}</p>{audit?.issues.slice(0,4).map((i,idx)=><div className="audit-issue" key={idx}><span/ ><span><b>{i.label}</b> — {i.detail}</span></div>)}<small>Rule-based checks. Visual balance still needs your review.</small></div></section>}

            {!isNew&&active&&<>
              <div className="results-toolbar"><div className="results-title"><strong>{active.name} · {directionCount(candidates)} {active.round===0?'original':candidates.some(c=>c.pairId)?'paired directions':'alternatives'}</strong><span className="round-pill">Round {active.round||'0'}</span><button className="icon-button small" title="Version history" aria-label="Version history" onClick={()=>setModal('history')}><History size={14}/></button></div><div className="canvas-controls"><div className="size-controls">{[24,48,64].map(n=><button key={n} className={size===n?'active':''} onClick={()=>setSize(n)} aria-label={`Preview at ${n} pixels`}>{n}</button>)}</div><span className="control-separator"/><button className={`icon-button small ${showGrid?'toggled':''}`} title="Toggle grid" aria-label="Toggle preview grid" aria-pressed={showGrid} onClick={()=>setShowGrid(!showGrid)}><Grid2X2 size={15}/></button><button className="icon-button small" title="Toggle canvas background" aria-label="Toggle canvas background" onClick={()=>setDarkCanvas(!darkCanvas)}>{darkCanvas?<Sun size={15}/>:<Moon size={15}/>}</button></div></div>
              <div className="construction-review-tools"><span>{standards.proportion==='square'?'1:1 artwork target':'Natural proportions'} · {GRID_LABELS[standards.constructionGrid||'none']}</span><label><input type="checkbox" checked={showConstructionGuides} onChange={e=>setShowConstructionGuides(e.target.checked)}/>Show construction guides</label></div>
              <div className={`candidate-grid ${darkCanvas?'dark-canvas':''} ${showGrid?'with-grid':''} ${busy?'generating':''}`}>
                {candidates.map((c,idx)=><article key={c.id} className={`candidate-card ${c.status==='shortlisted'?'shortlisted':''} ${c.status==='accepted'?'is-accepted':''}`}><div className="card-topline"><span className="direction-letter">{directionLetter(c,candidates)}</span>{c.status==='accepted'?<span className="accepted-label"><Check size={11}/>Accepted</span>:c.status==='shortlisted'?<span className="shortlist-label"><Heart size={10} fill="currentColor"/>Shortlisted</span>:idx===0&&c.source==='demo'?<span className="suggested-label">START HERE</span>:<span className="card-source">{c.source==='ai'?'AI DIRECTION':c.source==='demo'?'DEMO':c.source==='edited'?'EDITED':'SVG'}</span>}</div><button className="icon-canvas" onClick={()=>setInspect(c)} aria-label={`Inspect ${c.name}`}><span className="canvas-cross x1"/><span className="canvas-cross x2"/><span className="canvas-cross x3"/><span className="canvas-cross x4"/><SvgPreview svg={c.svg} size={size} standards={standards} showGuides={showConstructionGuides}/><span className="expand-hint"><Maximize2 size={13}/></span></button><div className="candidate-caption"><strong>{c.name}</strong>{c.treatment&&<em className="treatment-badge">{versionLabel(c)}</em>}<span>{c.svg.match(/viewBox=["']([^"']+)/)?.[1].split(/[\s,]+/).slice(2).join(' × ')||'SVG'} · {c.source==='demo'?'Demo direction':c.source==='ai'?'AI generated':c.source==='edited'?'Manually edited':'Vector SVG'}</span><IconMetrics svg={c.svg} targetSquare={standards.proportion==='square'} compact/></div><div className="candidate-actions"><button disabled={!!busy} className={c.status==='shortlisted'?'selected':''} onClick={()=>setCandidateStatus(c.id,'shortlisted')} aria-pressed={c.status==='shortlisted'}><Heart size={13} fill={c.status==='shortlisted'?'currentColor':'none'}/>{c.status==='shortlisted'?'Shortlisted':'Shortlist'}</button><button disabled={!!busy} onClick={()=>openEditor(c)} aria-label={`Edit ${c.name} with pen tool`}><PenTool size={12}/>Edit</button><button disabled={!!busy} className={c.status==='accepted'?'accepted-action':''} onClick={()=>setCandidateStatus(c.id,'accepted')}><Check size={13}/>{c.status==='accepted'?'Accepted':'Accept'}</button></div></article>)}
              </div>
              {active.suggestions?.length?<section className="suggestions"><Sparkles size={16}/><div><strong>{candidates.some(c=>c.source==='ai')?'A few things to consider':'A note on these directions'}</strong>{active.suggestions.map((s,i)=><p key={i}>{s}</p>)}</div></section>:null}
              <div className="canvas-caption"><span><Heart size={13}/>Shortlist 2–3 directions to refine, or accept your favorite.</span><span>SMALL DETAILS. BIG DIFFERENCE.</span></div>
            </>}
            {(isNew||!active)&&<div className="new-icon-empty"><div className="empty-icon-pile"><Grid2X2/><Sparkles/><Layers2/></div><strong>A little description. A world of directions.</strong><p>Tell us what it’s for. Your style standards will do the rest.</p><div className="prompt-chips">{['A folder for saved projects','A bell for notifications','A heart for favorites'].map(p=><button key={p} onClick={()=>changeBrief(p)}>{p}<Plus size={12}/></button>)}</div></div>}
          </>}
        </div>
        {selected.length>0&&tab!=='collection'&&!isNew&&<div className="refine-dock"><div className="shortlist-summary"><div className="shortlist-previews">{selected.map(c=><span key={c.id}><SvgPreview svg={c.svg} size={22}/></span>)}</div><div><strong>{directionCount(selected)} directions shortlisted</strong><small>{directionCount(selected)<2?'Choose one more direction to refine':'Good directions. Let’s go further.'}</small></div></div><input value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={1000} placeholder="What should change? e.g. simpler, more open…" aria-label="Refinement feedback"/><button className="button primary" disabled={directionCount(selected)<2||!!busy} onClick={()=>generate('refine')}><WandSparkles size={15}/>Refine selection<ArrowRight size={14}/></button></div>}
        {acceptedSvgCount>0&&<div className="export-dock" role="region" aria-label="Export accepted icons"><div className="export-dock-summary"><CheckCheck size={19}/><span><strong>{acceptedSvgCount} accepted {acceptedSvgCount===1?'SVG':'SVGs'}</strong><small>Ready to take with you</small></span></div><button className="button primary" onClick={downloadSet}><ArrowDownToLine size={16}/>Export set<span className="button-count">{acceptedSvgCount}</span></button></div>}
      </main>

      <aside className={`standards-panel compact-standards-panel ${mobilePanel==='standards'?'mobile-open':''}`}>
        <div className="panel-heading"><span><SlidersHorizontal size={17}/><strong>Your standards</strong></span><span className="live-indicator"/></div><p className="panel-subtitle">One system for every icon.</p>
        <StandardsControls standards={standards} onChange={updateStandards} creativity={creativity} onCreativityChange={setCreativity} disabled={!!busy} count={count} canFit={items.some(item=>item.candidates.some(candidate=>candidate.svg!==item.originalSvg))} fitting={busy==='fit'} onFit={()=>void fitExistingDesigns()}/>
        <div className="standard-actions compact-standards-actions"><p>Grid and stroke update live. Other settings guide new designs.</p><button className="text-button tertiary" onClick={()=>{const name=`${standards.colorMode!=='mono'?'Color':'Mono'} · ${standards.corner==='square'?'Rough':'Rounded'} · ${standards.style==='duotone'?'Color':standards.style==='line'?'Outlined':standards.style[0].toUpperCase()+standards.style.slice(1)} · ${standards.proportion==='square'?'1:1':'Natural'} · ${GRID_LABELS[standards.constructionGrid||'none']} · ${standards.perspective==='isometric'?'Isometric':'Face-on'} · ${standards.strokeWidth}u · R${standards.corner==='square'?0:standards.cornerRadius??1} · ${standards.gridSize}×${standards.gridSize}`;setPresets(p=>[...p.filter(x=>x.name!==name),{name,standards:{...standards}}].slice(-8));notice('Preset saved on this device.');}}><Plus size={13}/>Save as a preset</button>{presets.length>0&&<StudioSelect size="sm" label="Load standards preset" placeholder="Load a saved preset…" value="" disabled={!!busy} onValueChange={value=>{const p=presets.find(p=>p.name===value);if(p){updateStandards({...DEFAULT_STANDARDS,...p.standards,colorMode:p.standards.colorMode??(p.standards.style==='duotone'?'duo':'mono'),style:p.standards.style==='duotone'?'filled':p.standards.style});notice('Preset loaded. Canvas grid and stroke weight updated; other settings guide your next generation.');}}} options={presets.map(p=>({value:p.name,label:p.name}))}/>}</div>
      </aside>
    </div>
    <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple hidden onChange={e=>void upload(e.target.files)}/>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={13}/></button></div>}

    {editing&&<VectorEditor standards={standards} svg={editing.candidate.svg} name={items.find(i=>i.id===editing.itemId)?.name||editing.candidate.name} onSave={saveVectorEdit} onClose={()=>setEditing(null)}/>}
    {(modal||inspect)&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){connectionController.current?.abort();setModal(null);setInspect(null);}}}><div ref={dialogRef} className={`modal ${inspect?'inspect-modal':''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close icon-button" aria-label="Close dialog" onClick={()=>{connectionController.current?.abort();setModal(null);setInspect(null);}}><X size={20}/></button>
      {modal==='connect'&&<><span className="modal-icon"><KeyRound size={25}/></span><div className="eyebrow">AI SETTINGS</div><h2 id="modal-title">Your AI connection</h2><p>Choose a model and connect your OpenAI key. You can remember it on this browser.</p>{connected&&<div className="ai-generation-setting"><label><input type="checkbox" checked={useAI} disabled={!!busy||connectionBusy||forgettingKey} onChange={e=>setUseAI(e.target.checked)}/><span>Use AI for new designs</span></label><p>Switch off for demo previews. Redesigns, refinements, and isometric designs always use AI. Your saved key stays connected.</p></div>}<label className="field-label" htmlFor="api-key">OpenAI API key</label><input id="api-key" className="text-input" type="password" autoComplete="off" value={keyDraft} disabled={connectionBusy} onChange={e=>{setKeyDraft(e.target.value);setConnectionError('');}} placeholder={connected?'An AI connection is already active':'sk-…'}/><label className="field-label" htmlFor="model-name">Model</label><div className="model-presets" role="group" aria-label="Choose an AI model">{[{id:'gpt-6-astra',name:'GPT-6 Astra',detail:'Most capable · Higher cost'},{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',detail:'Balanced · Lower cost'}].map(option=><button key={option.id} type="button" disabled={connectionBusy||!!busy} aria-pressed={model===option.id} className={model===option.id?'chosen':''} onClick={()=>{setModel(option.id);setConnectionVerified(false);setConnectionError('');}}><strong>{option.name}</strong><span>{option.detail}</span></button>)}</div><input id="model-name" className="text-input" value={model} disabled={connectionBusy||!!busy} maxLength={80} onChange={e=>{setModel(e.target.value);setConnectionVerified(false);setConnectionError('');}} placeholder="Default model"/><p className="model-help">Your model choice is remembered. Verify access with your OpenAI key before generating.{model==='gpt-6-astra'&&<> Astra costs more per token than Sol. <a href="https://developers.openai.com/api/docs/models/gpt-6-astra" target="_blank" rel="noreferrer">View model details ↗</a></>}</p>{keySaved&&!keyDraft.trim()?<div className="remembered-key-status"><ShieldCheck size={17}/><span><strong>Key remembered on this browser</strong><small>Your connection survives refreshes. Use Forget key to remove it.</small></span></div>:<div className="remember-key-setting"><label><input type="checkbox" checked={rememberKey} disabled={!rememberAvailable||connectionBusy||forgettingKey} onChange={e=>setRememberKey(e.target.checked)}/><span>Remember my key</span></label><p>{rememberAvailable?'Encrypted and saved for 30 days on this browser.':'Remembering keys is unavailable on this instance.'}</p></div>}<div className="privacy-note"><ShieldCheck size={17}/><span>{rememberKey?'Iconoclast.ai encrypts your key in a private browser cookie that only the server can read. It is kept out of your workspace and page storage.':'Without Remember my key, your token stays in this tab’s memory and clears on refresh.'} Usage is billed to your OpenAI account.</span></div>{serverConfigured&&<div className="connection-notice"><Check size={14}/>A server connection is configured.</div>}{connectionError&&<div className="message error" role="alert">{connectionError}</div>}<button className="button primary full" disabled={connectionBusy||forgettingKey||(!keyDraft.trim()&&!connected)} onClick={connectAI}>{connectionBusy?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {connectionBusy?'Checking key and model…':rememberKey&&!keySaved?'Verify and save key':'Verify and connect'}</button>{connected&&<button className="text-button disconnect" disabled={connectionBusy||forgettingKey} onClick={forgetAIKey}>{forgettingKey?'Forgetting key…':keySaved?'Forget key & use demo mode':'Clear token & use demo mode'}</button>}<small className="modal-small">{keySaved?'Your saved key is encrypted and expires after 30 days.':'Choose Remember my key before connecting to keep it after refresh.'} Your uploaded icons and designs stay on this device.</small></>}
      {modal==='help'&&<><span className="modal-icon"><Sparkles size={26}/></span><div className="eyebrow">WELCOME TO ICONOCLAST.AI</div><h2 id="modal-title">A family of icons.<br/>A process that feels natural.</h2><div className="help-steps"><div><b>01</b><span><strong>Define your visual language</strong>Pick a style, weight, canvas, corners, and palette.</span></div><div><b>02</b><span><strong>Create or bring your own</strong>Write an icon brief, or upload a set of SVG files.</span></div><div><b>03</b><span><strong>Explore. Choose. Refine.</strong>Compare 4–8 alternatives. Accept one, or shortlist 2–3 and add feedback for the next round.</span></div><div><b>04</b><span><strong>Take your icons anywhere</strong>Export accepted icons as SVG. Your workspace saves automatically in this browser.</span></div></div><button className="button primary full" onClick={()=>setModal(null)}>Let’s make something<ArrowRight size={16}/></button></>}
      {modal==='history'&&<><span className="modal-icon"><History size={26}/></span><h2 id="modal-title">Room to explore.</h2><p>Every previous round stays here. Restore a direction whenever you need it.</p><div className="history-list">{active?.revisions?.length?([...active.revisions].reverse()).map((r,idx)=><div className="history-item" key={idx}><div className="history-thumbs">{r.candidates.slice(0,3).map(c=><SvgPreview key={c.id} svg={c.svg} size={28}/>)}</div><span><strong>Round {r.round}</strong><small>{r.candidates.length} directions · {r.standards.style}</small></span><button className="button secondary" onClick={()=>restoreRevision(r)}>Restore</button></div>):<div className="empty-history">Your next generation will save this round here.</div>}</div></>}
      {inspect&&<><div className="eyebrow">A CLOSER LOOK</div><h2 id="modal-title">{inspect.name}</h2>{inspect.treatment&&<span className="treatment-badge">{versionLabel(inspect)}</span>}<div className={`inspect-canvas ${darkCanvas?'dark-canvas':''}`}><SvgPreview svg={inspect.svg} size={200} standards={standards} showGuides={showConstructionGuides}/></div>{inspectedCanvas&&<p className="inspect-unit-caption">{inspectedCanvas.width} × {inspectedCanvas.height} grid · 1 square = 1 unit = 1 export pixel</p>}<div className="inspect-grid-actions"><label className="inspect-guide-toggle"><input type="checkbox" checked={showConstructionGuides} onChange={e=>setShowConstructionGuides(e.target.checked)}/>Show construction guides</label><button className="button secondary" disabled={!!busy||items.some(item=>item.originalSvg===inspect.svg)} onClick={()=>void fitExistingDesigns(standards,inspect.id)}>{busy==='fit'?<LoaderCircle size={14} className="spin"/>:<Maximize2 size={14}/>}Fit to {artworkSpan} × {artworkSpan}</button></div><p className="inspect-fit-target">{artworkFit.mode==='keyline'?'Keyline target':'Custom target'}: <strong>{artworkSpan} × {artworkSpan} u</strong> · Padding {artworkPadding} u · Stroke {standards.strokeWidth} u</p>{fitFeedback&&(!fitFeedback.candidateId||fitFeedback.candidateId===inspect.id)&&<p className={`inspect-fit-feedback${fitFeedback.error?' error':''}`} role={fitFeedback.error?'alert':'status'}>{fitFeedback.message}</p>}<IconMetrics svg={inspect.svg} targetSquare={standards.proportion==='square'}/><p>{inspect.rationale}</p><div className="inspect-sizes">{[16,24,32,48].map(n=><div key={n}><SvgPreview svg={inspect.svg} size={n}/><span>{n}px</span></div>)}</div><div className="modal-buttons"><button className="button secondary" onClick={()=>openEditor(inspect)}><PenTool size={15}/>Edit paths</button><button className="button secondary" onClick={()=>{navigator.clipboard.writeText(inspect.svg).then(()=>notice('SVG copied to your clipboard.')).catch(()=>notice('Clipboard unavailable. Download the SVG instead.'));}}><Copy size={15}/>Copy SVG</button><button className="button primary" onClick={()=>exportSvg(inspect.svg,candidateFileName(active?.name||inspect.name,inspect))}><Download size={15}/>Download SVG</button></div><details className="svg-code"><summary>View SVG source<FileCode2 size={14}/></summary><pre>{inspect.svg}</pre></details></>}
    </div></div>}
  </div>;
}
