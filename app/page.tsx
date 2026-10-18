'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Copy, Download, FileCode2, Grid2X2, Heart, History, KeyRound, Layers2, LoaderCircle, Maximize2, PanelLeftClose, PanelLeftOpen, Plus, PenTool, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
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
import IconLibrary, { type IconLibraryFilter, type LibraryPreviewSize, LIBRARY_PREVIEW_SIZES } from '@/components/icon-library';
import PreviewBackgroundToggle from '@/components/preview-background-toggle';
import { downloadLibrary, selectLibraryEntries, type LibrarySelection } from '@/lib/library-export';
import { removeLibraryEntries } from '@/lib/library-removal';
import SetToolbar from '@/components/set-toolbar';
import SvgUploadDropzone from '@/components/svg-upload-dropzone';
import SessionRulesPanel from '@/components/session-rules-panel';
import useRuleLearning from '@/components/use-rule-learning';
import { emptySessionRules, normalizeSessionRules, type SessionRules } from '@/lib/session-rules';
import { applyReviewDecision, ruleLearningFingerprint } from '@/lib/review-decisions';
import '@/components/review-cards.css';
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
const DRAFT_SESSION_ID = 'new-icon-draft';
type StudioSession = { id: string; name: string; svg?: string; draft: boolean };
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
  const [recentSessionIds, setRecentSessionIds] = useState<string[]>([]);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessionFocusRequest, setSessionFocusRequest] = useState<{itemId:string;focus:boolean}|null>(null);
  const [standards, setStandards] = useState<Standards>({ ...DEFAULT_STANDARDS });
  const [setName, setSetName] = useState('Everyday essentials');
  const [tab, setTab] = useState<Tab>('studio');
  const [brief, setBrief] = useState('');
  const [newBrief, setNewBrief] = useState('');
  const [draftRules, setDraftRules] = useState<{studio:SessionRules;refactor:SessionRules}>(()=>({studio:emptySessionRules(),refactor:emptySessionRules()}));
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
  const [libraryPreviewSize, setLibraryPreviewSize] = useState<LibraryPreviewSize>(48);
  const [libraryFilter, setLibraryFilter] = useState<IconLibraryFilter>('all');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [showGrid, setShowGrid] = useState(true);
  const [showConstructionGuides, setShowConstructionGuides] = useState(true);
  const [size, setSize] = useState(64);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [newBriefFocusRequest, setNewBriefFocusRequest] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<'icons' | 'standards' | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [presets, setPresets] = useState<{name:string;standards:Standards}[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const collapseSidebarRef = useRef<HTMLButtonElement>(null);
  const expandSidebarRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strokeUpdate = useRef(0);
  const active = items.find(i => i.id === activeId);
    const accepted = items.filter(i => i.candidates.some(c => c.status === 'accepted'));
  const acceptedSvgCount = accepted.reduce((total, item) => total + item.candidates.filter(candidate => candidate.status === 'accepted').length, 0);
  const connected = !!apiKey || keySaved || serverConfigured;
  const aiEnabled = connected && useAI;
  const candidates = active?.candidates ?? [];
  const recentSessions = recentSessionIds.map((id):StudioSession|null => {
    if(id===DRAFT_SESSION_ID)return newBrief.trim()?{id,name:'New icon draft',draft:true}:null;
    const item=items.find(value=>value.id===id);
    return item?{id,name:item.name,svg:item.candidates.find(candidate=>candidate.status==='accepted')?.svg||item.candidates[0]?.svg||item.originalSvg,draft:false}:null;
  }).filter((session):session is StudioSession=>session!==null);
  const visibleSessions = showAllSessions?recentSessions:recentSessions.slice(0,5);
  const uploaded = items.filter(i=>i.originalSvg);
  const hasActiveRedesign = !isNew && !!active?.originalSvg;
  const showWorkspaceIntro = tab==='studio' ? isNew || candidates.length===0 : tab==='refactor' && !hasActiveRedesign;
  const batchTargets = uploaded.filter(i=>batchIds.includes(i.id));
  const hasUpload = !isNew && !!active?.originalSvg;
  const inspectedCanvas = inspect ? getSvgCanvas(inspect.svg) : null;
  const ruleLearning = useRuleLearning({items, standards, apiKey, model, enabled:connected&&useAI, onSuggestions:(itemId,fingerprint,suggestions)=>setItems(previous=>previous.map(item=>item.id===itemId&&ruleLearningFingerprint(item,standards)===fingerprint?{...item,sessionRules:{...normalizeSessionRules(item.sessionRules),suggestions}}:item))});
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
          const checked = data.items.map((i: StudioItem) => ({ ...i, sessionRules:normalizeSessionRules(i.sessionRules), originalSvg: i.originalSvg ? sanitizeSvg(i.originalSvg) : undefined, candidates: i.candidates.map(c => ({ ...c, svg: sanitizeSvg(c.svg) })), revisions: (i.revisions ?? []).map(r=>({...r,candidates:r.candidates.map(c=>({...c,svg:sanitizeSvg(c.svg)}))})) }));
          const uploads = checked.filter((i:StudioItem)=>i.originalSvg);
          const focused = checked.find((i:StudioItem)=>i.id===data.activeId) || uploads[0] || checked[0];
          const restoredTab:Tab = ['studio','refactor','collection'].includes(data.tab) ? data.tab : uploads.length ? 'refactor' : 'studio';
          const draft = typeof data.newBrief==='string' ? data.newBrief.slice(0,2000) : '';
          const creating = restoredTab!=='collection' && (data.isNew===true || (restoredTab==='studio' && !!focused?.originalSvg));
          setItems(checked); setActiveId(creating?'':focused?.id ?? ''); setNewBrief(draft); setIsNew(creating); setBrief(creating?(restoredTab==='studio'?draft:''):focused?.brief ?? '');
          setTab(restoredTab);
          setDraftRules({studio:normalizeSessionRules(data.draftRules?.studio),refactor:normalizeSessionRules(data.draftRules?.refactor)});
          const sessionIds = Array.isArray(data.recentSessionIds)
            ? [...new Set<string>(data.recentSessionIds.filter((id:unknown):id is string=>typeof id==='string'&&(id===DRAFT_SESSION_ID?!!draft.trim():checked.some((item:StudioItem)=>item.id===id))))].slice(0,101)
            : [...(draft.trim()?[DRAFT_SESSION_ID]:[]),...(focused&&(!focused.id.startsWith('sample-')||focused.round>1||focused.candidates.some((candidate:Candidate)=>candidate.source==='ai'||candidate.source==='edited'))?[focused.id]:[])];
          setRecentSessionIds(sessionIds);
          if(restoredTab==='refactor'&&!creating&&focused?.originalSvg)setSessionFocusRequest({itemId:focused.id,focus:false});
          if(['faithful','exploratory','radical'].includes(data.creativity))setCreativity(data.creativity);
          if(Number.isInteger(data.count)&&data.count>=4&&data.count<=8)setCount(data.count);
          if(typeof data.showConstructionGuides==='boolean')setShowConstructionGuides(data.showConstructionGuides);
          if(typeof data.darkCanvas==='boolean')setDarkCanvas(data.darkCanvas);
          if(LIBRARY_PREVIEW_SIZES.includes(data.libraryPreviewSize))setLibraryPreviewSize(data.libraryPreviewSize);
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, standards, name: setName, presets, activeId, tab, batchIds, creativity, count, batchFeedback, model, showConstructionGuides, darkCanvas, libraryPreviewSize, newBrief, isNew, sidebarCollapsed, recentSessionIds, draftRules })); }
    catch { setError('Browser storage is full or unavailable. Export your work before closing this page.'); }
  }, [items, standards, setName, ready, presets, activeId, tab, batchIds, creativity, count, batchFeedback, model, showConstructionGuides, darkCanvas, libraryPreviewSize, newBrief, isNew, sidebarCollapsed, recentSessionIds, draftRules]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { connectionController.current?.abort(); setModal(null); setInspect(null); setMobilePanel(null); }
    };
    window.addEventListener('keydown',handler); return()=>window.removeEventListener('keydown',handler);
  }, []);

  useEffect(() => { setFitFeedback(null); }, [inspect?.id]);

  useEffect(() => {
    if(!newBriefFocusRequest || !isNew || tab==='collection')return;
    workspaceScrollRef.current?.scrollTo({top:0});
    if(tab==='studio')briefRef.current?.focus({preventScroll:true});
  }, [newBriefFocusRequest, isNew, tab]);

  useEffect(() => {
    if(!ready||!sessionFocusRequest||tab==='collection')return;
    const frame=requestAnimationFrame(()=>{
      const scroller=workspaceScrollRef.current;
      if(!scroller)return;
      if(tab==='refactor') {
        const heading=document.getElementById(`isb-name-${sessionFocusRequest.itemId}`);
        const row=heading?.closest<HTMLElement>('.isb-row');
        if(row) {
          const toolbarHeight=scroller.querySelector('.set-toolbar')?.getBoundingClientRect().height??0;
          scroller.scrollTo({top:Math.max(0,scroller.scrollTop+row.getBoundingClientRect().top-scroller.getBoundingClientRect().top-toolbarHeight-12)});
          if(sessionFocusRequest.focus)heading?.closest<HTMLButtonElement>('button')?.focus({preventScroll:true});
        }
      } else {
        scroller.scrollTo({top:0});
        if(sessionFocusRequest.focus)briefRef.current?.focus({preventScroll:true});
      }
      setSessionFocusRequest(null);
    });
    return()=>cancelAnimationFrame(frame);
  }, [ready,sessionFocusRequest,tab]);

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
  const recordSession = (id:string, replaceDraft=false) => setRecentSessionIds(previous=>previous[0]===id&&!replaceDraft?previous:[id,...previous.filter(value=>value!==id&&(!replaceDraft||value!==DRAFT_SESSION_ID))].slice(0,101));
  const chooseIcon = (i: StudioItem) => { recordSession(i.id); setActiveId(i.id); setBrief(i.brief); setIsNew(false); setFeedback(''); setError(''); setMobilePanel(null); setTab(i.originalSvg?'refactor':'studio'); };
  const openSession = (itemId:string) => {
    if(busy)return;
    const item=items.find(value=>value.id===itemId);
    if(!item)return;
    chooseIcon(item);
    setSessionFocusRequest({itemId,focus:true});
  };
  const openNewIcon = (resetDraft = false) => {
    if(busy)return;
    setActiveId(''); setIsNew(true); setBrief(resetDraft?'':newBrief);
    if(resetDraft){setDraftRules(previous=>({...previous,studio:emptySessionRules()}));setNewBrief('');setRecentSessionIds(previous=>previous.filter(id=>id!==DRAFT_SESSION_ID));}
    else if(newBrief.trim())recordSession(DRAFT_SESSION_ID);
    setTab('studio'); setFeedback(''); setError(''); setMobilePanel(null);
    setNewBriefFocusRequest(request=>request+1);
  };
  const switchWorkspace = (next:'studio'|'refactor') => {
    if(busy)return;
    if(next==='studio') { openNewIcon(); return; }
    setError(''); setFeedback(''); setMobilePanel(null);
    setActiveId(''); setBrief(''); setIsNew(true); setTab('refactor');
    setSessionFocusRequest(null);
    setNewBriefFocusRequest(request=>request+1);
  };
  const changeBrief = (value:string) => {
    setBrief(value);
    if(isNew) {
      setNewBrief(value);
      if(value.trim())recordSession(DRAFT_SESSION_ID);
      else setRecentSessionIds(previous=>previous.filter(id=>id!==DRAFT_SESSION_ID));
    } else if(active) {
      const itemId=active.id;
      setItems(previous=>previous.map(item=>item.id===itemId?{...item,brief:value}:item));
      recordSession(itemId);
    }
  };
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
    const sessionRules=normalizeSessionRules(target?target.sessionRules:draftRules.studio);
    if(runAI)setUseAI(true);
    if(target)ruleLearning.cancel(target.id);
    if(target?.originalSvg)setBatchStates(old=>({...old,[targetId]:'working'}));
    try {
      let generated: Candidate[]; let suggestions: string[] = []; let analysis: StudioItem['analysis'];
      if(runAI) {
        setRequestProgress({name:target?.name||'New icon',phase:'Preparing reference previews',startedAt:Date.now()});
        const references = mode==='refine'?shortlisted.map(c=>c.svg):mode==='redesign'?selectFamilyReferences(focused!,items):[];
        const referenceImages = await renderReferenceImages(references);
        setRequestProgress(p=>({...p,phase:'Waiting for OpenAI'}));
        const response = await fetch('/api/generate', {method:'POST',headers:{'Content-Type':'application/json'},signal:controller.current.signal,body:JSON.stringify({brief:designBrief,standards,count,mode,creativity,rules:sessionRules.rules.map(rule=>rule.text),feedback:mode==='redesign'?batchFeedback:feedback,references,referenceImages,apiKey:apiKey||undefined,model:model||undefined})});
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
      const item:StudioItem={...target,sessionRules,id:targetId,name:target?.name || designBrief.trim().split(/[.!?\n]/)[0].split(' ').slice(0,5).join(' '),brief:designBrief.trim(),candidates:generated,round:nextRound,standards:{...standards},suggestions,analysis,revisions:[...(target?.revisions??[]),...(revision?[revision]:[])].slice(-10)};
      setItems(old=>target?old.map(i=>i.id===targetId?item:i):[...old,item]); setActiveId(targetId); setBrief(designBrief.trim()); if(target?.originalSvg)setBatchStates(old=>({...old,[targetId]:'done'})); setIsNew(false); recordSession(targetId,!target); if(!target){setNewBrief('');setDraftRules(previous=>({...previous,studio:emptySessionRules()}));} setFeedback(''); setTab(target?.originalSvg?'refactor':'studio'); notice(`${directionCount(generated)} ${standards.style==='both'?'paired ':''}${runAI?'AI':'demo'} directions are ready for ${item.name}.`);
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
      ruleLearning.cancel(item.id);
      setBatchStates(old=>({...old,[item.id]:'working'}));
      setRequestProgress({name:item.name,phase:'Preparing reference previews',startedAt:Date.now()});
      try {
        const references=selectFamilyReferences(item,items);
        const referenceImages=await renderReferenceImages(references);
        setRequestProgress(p=>({...p,phase:'Waiting for OpenAI'}));
        const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:aborter.signal,body:JSON.stringify({brief:item.brief,standards,count,mode:'redesign',creativity,rules:normalizeSessionRules(item.sessionRules).rules.map(rule=>rule.text),references,referenceImages,feedback:batchFeedback.trim()||'Creatively redesign this icon. Preserve its meaning, rethink the geometry and make it belong to the shared visual family.',apiKey:apiKey||undefined,model:model||undefined})});
        const data=await response.json() as GenerationResult&{error?:string|{message?:string};code?:string};
        if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:data.error?.message||'Generation failed.'),{code:data.code});
        if(!Array.isArray(data.candidates)||data.candidates.length!==(standards.style==='both'?count*2:count))throw new Error('Incomplete alternatives returned.');
        setConnectionVerified(true);setRequestProgress(p=>({...p,phase:'Checking the SVG designs'}));
        const generated:Candidate[]=await Promise.all(data.candidates.map(async c=>({...c,id:uid(),svg:sanitizeSvg(await applyEditableCorners(sanitizeSvg(c.svg),standards)),status:'pending' as const,source:'ai' as const})));
        if(aborter.signal.aborted)break;
        setItems(old=>old.map(i=>i.id!==item.id?i:{...i,candidates:generated,round:i.round+1,standards:{...standards},suggestions:data.suggestions,analysis:data.analysis,revisions:[...(i.revisions??[]),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Before creative redesign',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}].slice(-10)}));completed++;recordSession(item.id);
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
    recordSession(itemId);setInspect(null);setModal(null);setEditing({itemId,candidate});
  }
  function saveVectorEdit(svg:string) {
    if(!editing)return;
    try{
      const safe=sanitizeSvg(svg);
      const edited:Candidate={...editing.candidate,id:uid(),svg:safe,name:editing.candidate.name.replace(/ · Edited$/,'')+' · Edited',rationale:'Manually edited with the vector tools. Review the geometry and accept when ready.',status:'pending',source:'edited'};
      setItems(old=>old.map(i=>i.id!==editing.itemId?i:{...i,round:i.round+1,candidates:i.candidates.some(c=>c.id===editing.candidate.id)?i.candidates.map(c=>c.id===editing.candidate.id?edited:c):[...i.candidates,edited],revisions:[...(i.revisions??[]),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Before vector editing',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}].slice(-10)}));
      recordSession(editing.itemId);setEditing(null);notice('Vector edit saved as a new round. Review and accept when ready.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save the edited SVG.');throw e;}
  }

  function setCandidateStatus(id:string,status:Candidate['status'],itemId=activeId) {
    const item=items.find(value=>value.id===itemId);
    if(!item||busy||status==='shortlisted')return;
    const next=applyReviewDecision(item,id,status);
    if(next===item)return;
    setItems(previous=>previous.map(value=>value.id===itemId?next:value));
    setInspect(previous=>previous?.id===id?next.candidates.find(candidate=>candidate.id===id)??previous:previous);
    recordSession(itemId);
    ruleLearning.request(next);
    const reviewed=next.candidates.find(candidate=>candidate.id===id);
    if(reviewed&&(reviewed.status==='accepted'||reviewed.status==='rejected')&&!next.sessionRules?.feedback.some(entry=>entry.candidateId===id))notice('Decision saved. This SVG is too complex for automatic rule suggestions; you can add a session rule manually.');
  }

  function changeSessionRules(value:SessionRules,itemId?:string,mode:'studio'|'refactor'='studio') {
    if(busy)return;
    const safe=normalizeSessionRules(value);
    if(itemId){
      ruleLearning.cancel(itemId);
      setItems(previous=>previous.map(item=>item.id===itemId?{...item,sessionRules:safe}:item));
      recordSession(itemId);
    }else setDraftRules(previous=>({...previous,[mode]:safe}));
  }

  function sessionRulesPanel(item?:IconItem,mode:'studio'|'refactor'='studio') {
    const state=item?item.sessionRules:draftRules[mode];
    return <SessionRulesPanel key={item?.id??`draft-${mode}`} value={normalizeSessionRules(state)} onChange={value=>changeSessionRules(value,item?.id,mode)} disabled={!!busy} learning={item?ruleLearning.states[item.id]?.learning:false} error={item?ruleLearning.states[item.id]?.error:undefined} aiEnabled={connected&&useAI} onConnect={()=>setModal('connect')} onRetry={()=>{if(item)ruleLearning.request(item);}}/>;
  }

  async function upload(files:FileList|null) {
    if(!files || busy || uploadInFlight.current) return;
    const incoming=Array.from(files); const errors:string[]=[]; const added:StudioItem[]=[];
    if(items.length+incoming.length>100) { setError('A workspace can hold up to 100 icons. Upload a smaller set.'); return; }
    uploadInFlight.current = true;
    try {
    for(const file of incoming) {
      try {
        if(!file.name.toLowerCase().endsWith('.svg')) throw new Error('Only SVG files are supported.');
        if(file.size>200_000) throw new Error('SVG must be smaller than 200 KB.');
        const svg=sanitizeSvg(await file.text());
        const name=file.name.replace(/\.svg$/i,'').replace(/[-_]/g,' ');
        added.push({id:uid(),name,sessionRules:normalizeSessionRules(draftRules.refactor),brief:`Refine this ${name} icon. Preserve its meaning and align it with the set.`,originalSvg:svg,candidates:[{id:uid(),name:'Original upload',svg,rationale:'Your source SVG, preserved for comparison.',status:'pending',source:'normalized'}],round:0,standards:{...standards}});
      } catch(e) { errors.push(`${file.name}: ${e instanceof Error?e.message:'Could not read SVG.'}`); }
    }
    setUploadErrors(errors);
    if(added.length) { setDraftRules(previous=>({...previous,refactor:emptySessionRules()})); setItems(old=>[...old,...added]); setBatchIds(old=>isNew?added.map(i=>i.id):[...old,...added.map(i=>i.id)]); setRecentSessionIds(previous=>[...added.map(item=>item.id),...previous].slice(0,101)); chooseIcon(added[0]); setSessionFocusRequest({itemId:added[0].id,focus:false}); setTab('refactor'); notice(`${added.length} ${added.length===1?'icon':'icons'} imported. All uploads are visible in your set.`); }
    } finally {
      uploadInFlight.current = false;
      if(fileRef.current) fileRef.current.value='';
    }
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
      setItems(old=>old.map(i=>updates.get(i.id)||i));targets.forEach(item=>recordSession(item.id));notice(`Palette applied to ${targets.length} icons. Shapes and originals are preserved; review the recolored designs.`);
    }catch(e){setError(e instanceof Error?e.message:'Could not apply the palette. Previous designs are unchanged.');}
  }
  function removeIcon(id:string) {
    removeIcons([id]);
  }
  function removeIcons(ids:string[]) {
    if(busy)return;
    const removed=new Set(ids.filter(id=>items.some(item=>item.id===id)));
    if(!removed.size)return;
    setItems(previous=>previous.filter(item=>!removed.has(item.id)));
    setBatchIds(previous=>previous.filter(id=>!removed.has(id)));
    setRecentSessionIds(previous=>previous.filter(id=>!removed.has(id)));
    setBatchStates(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!removed.has(id))));
    if(removed.has(activeId)){setActiveId('');setBrief(newBrief);setIsNew(true);}
    notice(`${removed.size} ${removed.size===1?'icon family':'icon families'} removed from this workspace.`);
  }
  function removeSelectedLibraryEntries(selection:LibrarySelection[]) {
    if(busy)return;
    const remaining=removeLibraryEntries(items,selection);
    const familyIds=new Set(remaining.map(item=>item.id));
    const uploadedIds=new Set(remaining.filter(item=>item.originalSvg).map(item=>item.id));
    setItems(remaining);
    setRecentSessionIds(previous=>previous.filter(id=>id===DRAFT_SESSION_ID||familyIds.has(id)));
    setBatchIds(previous=>previous.filter(id=>uploadedIds.has(id)));
    setBatchStates(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>uploadedIds.has(id))));
    const focused=remaining.find(item=>item.id===activeId);
    if(!focused){setActiveId('');setBrief(newBrief);setIsNew(true);}
    else if(tab==='refactor'&&!focused.originalSvg){setTab('studio');setBrief(focused.brief);}
    notice('Selected SVGs removed. Other versions are preserved.');
  }
  function downloadLibraryItems(ids:string[]) {
    try { downloadLibrary(items.filter(item=>ids.includes(item.id)));notice('Your library SVG archive is ready to download.'); }
    catch(error){setError(error instanceof Error?error.message:'Library export failed.');}
  }
  function downloadSelectedLibraryEntries(selection:LibrarySelection[]) {
    try { downloadLibrary(selectLibraryEntries(items,selection));notice('Your selected SVG archive is ready to download.'); }
    catch(error){setError(error instanceof Error?error.message:'Library export failed.');}
  }
  function downloadSet() { if(!accepted.length){notice('Accept at least one direction to export your set.');return;} try{exportSet(accepted,standards);notice('Your accepted SVG set is ready to download.');}catch(e){setError(e instanceof Error?e.message:'Export failed.');} }
  function restoreRevision(rev:Revision) {
    if(!active)return;
    setItems(old=>old.map(i=>i.id!==active.id?i:{...i,candidates:rev.candidates,round:rev.round,standards:rev.standards,brief:rev.brief??i.brief,analysis:rev.analysis,suggestions:rev.suggestions,revisions:[...(i.revisions??[]).filter(r=>r!==rev),{round:i.round,candidates:i.candidates,standards:i.standards||standards,feedback:'Saved before restore',brief:i.brief,analysis:i.analysis,suggestions:i.suggestions}]}));setBrief(rev.brief??active.brief);recordSession(active.id);setModal(null);notice(`Restored round ${rev.round}.`);
  }

  return <div className={`app-shell has-sidebar-brand ${acceptedSvgCount>0?'has-export-selection':''}`}>
    <nav className="mobile-tools"><button aria-expanded={mobilePanel==='icons'} aria-controls="workspace-sidebar" onClick={()=>setMobilePanel(mobilePanel==='icons'?null:'icons')}><Layers2 size={16}/>Workspace</button><button onClick={()=>setMobilePanel(mobilePanel==='standards'?null:'standards')}><SlidersHorizontal size={16}/>Standards</button></nav>
    <div className={`studio-layout ${sidebarCollapsed?'sidebar-collapsed':''}`}>
      {sidebarCollapsed&&<button ref={expandSidebarRef} className="sidebar-toggle sidebar-expand-button sidebar-edge-toggle" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded={false} aria-controls="workspace-sidebar" onClick={toggleSidebar}><PanelLeftOpen size={17}/></button>}
      <aside id="workspace-sidebar" aria-label="Studio, library, and workspace" className={`sidebar ${mobilePanel==='icons'?'mobile-open':''}`}>
        <div className="sidebar-brand-row"><a className="brand" href="/" aria-label="iconoklast.app home"><Logo /><span>iconoklast<span className="brand-dot">.app</span></span></a><button ref={collapseSidebarRef} className="sidebar-toggle sidebar-collapse-button" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={toggleSidebar}><PanelLeftClose size={17}/></button><button className="sidebar-toggle sidebar-mobile-close" aria-label="Close icons sidebar" onClick={()=>setMobilePanel(null)}><X size={18}/></button></div>
        <div className="sidebar-project"><div className="sidebar-project-meta"><span><i/>Saved on this device</span><button className="icon-button small" title="How iconoklast.app works" aria-label="How iconoklast.app works" onClick={()=>setModal('help')}><CircleHelp size={16}/></button></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Workspace views">
          <button className={tab!=='collection'?'active':''} aria-current={tab!=='collection'?'page':undefined} onClick={()=>switchWorkspace('studio')} disabled={!!busy}><WandSparkles size={17}/>Icon studio</button>
          {recentSessions.length>0&&<div className="sidebar-sessions" role="group" aria-label="Recent studio sessions">
            <ul>{visibleSessions.map(session=><li key={session.id}><button type="button" className={`sidebar-session-button ${tab!=='collection'&&(session.draft?isNew&&tab==='studio':!isNew&&activeId===session.id)?'is-current':''}`} aria-pressed={tab!=='collection'&&(session.draft?isNew&&tab==='studio':!isNew&&activeId===session.id)} disabled={!!busy} title={session.draft?newBrief:`Resume ${session.name}`} onClick={()=>session.draft?openNewIcon():openSession(session.id)}>
              <span className={`sidebar-session-preview ${session.draft?'is-draft':''}`}>{session.draft?<PenTool size={13}/>:<SvgPreview svg={session.svg} size={16}/>}</span><span className="sidebar-session-name">{session.name}</span>
            </button></li>)}</ul>
            {recentSessions.length>5&&<button type="button" className="sidebar-sessions-toggle" aria-expanded={showAllSessions} onClick={()=>setShowAllSessions(value=>!value)}>{showAllSessions?'Show less':`Show all (${recentSessions.length})`}<ChevronDown size={12}/></button>}
          </div>}
          <button className={tab==='collection'?'active':''} aria-current={tab==='collection'?'page':undefined} onClick={()=>{setTab('collection');setMobilePanel(null);workspaceScrollRef.current?.scrollTo({top:0});}}><Grid2X2 size={17}/>Library<span className="nav-badge">{items.length}</span></button>
        </nav>
        <div className="sidebar-bottom"><button className="connection-card" aria-label="LLM API settings" onClick={()=>setModal('connect')}><span className={`connection-icon ${connected?'connected':''}`}><Sparkles size={17}/></span><span><strong>LLM API settings</strong><small className={`connection-status-badge ${aiEnabled?'is-enabled':''}`}>{aiEnabled?'AI Enabled':'AI Not Enabled'}</small></span><ChevronRight size={14}/></button></div>
      </aside>

      <main className={`main-workspace ${tab==='refactor'?'set-workspace':''} ${showWorkspaceIntro?'has-workspace-intro':''}`}>
        <div className="workspace-scroll" ref={workspaceScrollRef}>
          {showWorkspaceIntro&&<div className="page-heading compact-workspace-intro"><h1>Every great icon starts here.</h1><p>Explore a few directions. Find the one that feels right.</p></div>}

          {error&&<div className="message error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
          {uploadErrors.length>0&&<div className="message error" role="alert"><div><strong>Some icons need attention</strong>{uploadErrors.map((e,i)=><p key={i}>{e}</p>)}</div><button aria-label="Dismiss upload errors" onClick={()=>setUploadErrors([])}><X size={14}/></button></div>}

          {tab!=='collection'&&(!active||isNew)&&<div className="workspace-mode-switch" role="group" aria-label="Icon studio mode">
            <button type="button" aria-pressed={tab==='studio'} disabled={!!busy} onClick={()=>switchWorkspace('studio')}><Sparkles size={15}/>Design new</button>
            <button type="button" aria-pressed={tab==='refactor'} disabled={!!busy} onClick={()=>switchWorkspace('refactor')}><WandSparkles size={15}/>Redesign</button>
          </div>}

          {tab==='collection'?<IconLibrary items={items} standards={standards} busy={!!busy}
            darkCanvas={darkCanvas} previewSize={libraryPreviewSize} onPreviewSizeChange={setLibraryPreviewSize}
            filter={libraryFilter} onFilterChange={setLibraryFilter} query={libraryQuery} onQueryChange={setLibraryQuery}
            onOpenItem={openSession}
            onInspect={(itemId,candidate)=>{const item=items.find(i=>i.id===itemId);if(item){recordSession(itemId);setActiveId(itemId);setBrief(item.brief);setIsNew(false);setInspect(candidate);}}}
            onEdit={(itemId,candidate)=>openEditor(candidate,itemId)}
            onStatus={(itemId,candidateId,status)=>setCandidateStatus(candidateId,status,itemId)}
            onDownload={(itemId,candidate)=>exportSvg(candidate.svg,candidateFileName(items.find(i=>i.id===itemId)?.name||candidate.name,candidate))}
            onRemoveItem={removeIcon} onDownloadItems={downloadLibraryItems} onRemoveItems={removeIcons}
            onDownloadEntries={downloadSelectedLibraryEntries} onRemoveEntries={removeSelectedLibraryEntries}/>
          :tab==='refactor'?<>
            {hasActiveRedesign?<>
              <SetToolbar total={uploaded.length} selected={batchTargets.length} count={count} onCountChange={setCount}
                brief={batchFeedback} onBriefChange={setBatchFeedback} connected={connected} busy={!!busy}
                canRecolor={batchTargets.some(i=>i.round>0)} onAddSvgs={()=>fileRef.current?.click()} onRecolor={applyPalette}
                onRedesign={refactorUploadedSet} onCancel={()=>controller.current?.abort()} onConnect={()=>setModal('connect')}
                onToggleAll={()=>setBatchIds(batchTargets.length===uploaded.length?[]:uploaded.map(i=>i.id))}
                showGuides={showConstructionGuides} onShowGuidesChange={setShowConstructionGuides}
                proportionLabel={standards.proportion==='square'?'1:1 artwork':'Natural proportions'} gridLabel={GRID_LABELS[standards.constructionGrid||'none']}/>
              {busy&&busy!=='fit'&&<GenerationProgress {...requestProgress} count={count} completed={busy==='batch'?batchProgress.done:0} total={busy==='batch'?batchProgress.total:1}/>}
              <IconSetBoard darkCanvas={darkCanvas} standards={standards} showGuides={showConstructionGuides} items={uploaded} selectedIds={batchIds} activeId={activeId} busy={!!busy} states={batchStates}
                onToggle={id=>setBatchIds(old=>old.includes(id)?old.filter(i=>i!==id):[...old,id])}
                onFocus={id=>{const i=items.find(i=>i.id===id);if(i)chooseIcon(i);}}
                onBriefChange={(id,value)=>{recordSession(id);setItems(old=>old.map(i=>i.id===id?{...i,brief:value}:i));if(id===activeId)setBrief(value);}}
                onRedesign={id=>{const i=items.find(i=>i.id===id);if(i)void generate('redesign',i);}}
                onStatus={(itemId,id,status)=>setCandidateStatus(id,status,itemId)}
                renderRules={item=>sessionRulesPanel(item,'refactor')}
                onInspect={(itemId,c)=>{const i=items.find(i=>i.id===itemId);if(i)chooseIcon(i);setInspect(c);}}
                onHistory={id=>{const i=items.find(i=>i.id===id);if(i)chooseIcon(i);setModal('history');}}/>
            </>:<><SvgUploadDropzone disabled={!!busy} onBrowse={()=>fileRef.current?.click()} onFiles={upload}/>{sessionRulesPanel(undefined,'refactor')}</>}
          </>:<>
            <section className="brief-card"><div className="brief-heading"><label htmlFor="icon-brief"><Sparkles size={15}/>{hasUpload?`Redesign brief · ${active?.name}`:'What should your icon communicate?'}</label><span id="icon-brief-mode" className="brief-mode-label">{hasUpload?'Redesign':'Design new'}</span></div><textarea id="icon-brief" aria-describedby="icon-brief-mode" ref={briefRef} value={brief} maxLength={2000} disabled={!!busy} onChange={e=>changeBrief(e.target.value)} placeholder="A workspace icon for a productivity app. Simple, welcoming, with a sense of structure…"/><div className="brief-bottom"><div className="direction-count"><label htmlFor="direction-count">Directions</label><StudioSelect id="direction-count" label="Directions" value={String(count)} disabled={!!busy} size="sm" onValueChange={value=>setCount(Number(value))} options={[4,5,6,7,8].map(n=>({value:String(n),label:`${n} ${standards.style==='both'?'pairs':'alternatives'}`}))}/></div>{busy?<button className="button secondary" onClick={()=>controller.current?.abort()}><LoaderCircle size={15} className="spin"/>Cancel</button>:<button className="button primary" onClick={()=>generate(hasUpload?'redesign':'create')}><Sparkles size={15}/>{hasUpload?'Redesign this icon':useAI||standards.perspective==='isometric'?'Generate alternatives':'Preview demo icons'}<span className="enter-symbol">↵</span></button>}</div></section>
            {busy&&busy!=='fit'&&(useAI||busy!=='create')&&<GenerationProgress {...requestProgress} count={count} completed={0} total={1}/>}
            <div className="demo-note"><span className={`tiny-dot ${useAI?'purple':''}`}/>{hasUpload?(connected?'AI redraws the icon’s geometry using your creative direction. The original stays available.':'Creative redesign requires AI. Connect your token to explore new geometry for each uploaded icon.'):useAI?'Your brief and references are sent to OpenAI when you generate.':'Demo samples are handcrafted. Connect AI for icons designed from your brief.'}{standards.style==='both'&&<span> Both produces {count} outlined + {count} filled SVGs in one request; more output can use more tokens.</span>}{!connected&&<button onClick={()=>setModal('connect')}>Connect AI<ArrowRight size={11}/></button>}</div>

            {sessionRulesPanel(!isNew?active:undefined)}
            {!isNew&&active?.originalSvg&&<section className="audit-card"><div className="source-preview"><SvgPreview svg={active.originalSvg} size={42}/><span>ORIGINAL</span></div><div className="audit-copy"><div><strong>Consistency review</strong><span className={`score ${audit&&audit.score>=85?'good':''}`}>{audit?.score??'—'} / 100</span></div><p>{audit?.issues.length?`${audit.issues.length} points to review against your standards.`:'The source matches the measurable style checks.'}</p>{audit?.issues.slice(0,4).map((i,idx)=><div className="audit-issue" key={idx}><span/ ><span><b>{i.label}</b> — {i.detail}</span></div>)}<small>Rule-based checks. Visual balance still needs your review.</small></div></section>}

            {!isNew&&active&&<>
              <div className="results-toolbar"><div className="results-title"><strong>{active.name} · {directionCount(candidates)} {active.round===0?'original':candidates.some(c=>c.pairId)?'paired directions':'alternatives'}</strong><span className="round-pill">Round {active.round||'0'}</span><button className="icon-button small" title="Version history" aria-label="Version history" onClick={()=>setModal('history')}><History size={14}/></button></div><div className="canvas-controls"><div className="size-controls">{[24,48,64].map(n=><button key={n} className={size===n?'active':''} onClick={()=>setSize(n)} aria-label={`Preview at ${n} pixels`}>{n}</button>)}</div><span className="control-separator"/><button className={`icon-button small ${showGrid?'toggled':''}`} title="Toggle grid" aria-label="Toggle preview grid" aria-pressed={showGrid} onClick={()=>setShowGrid(!showGrid)}><Grid2X2 size={15}/></button></div></div>
              <div className="construction-review-tools"><span>{standards.proportion==='square'?'1:1 artwork target':'Natural proportions'} · {GRID_LABELS[standards.constructionGrid||'none']}</span><label><input type="checkbox" checked={showConstructionGuides} onChange={e=>setShowConstructionGuides(e.target.checked)}/>Show construction guides</label></div>
              <div className={`candidate-grid ${darkCanvas?'dark-canvas':''} ${showGrid?'with-grid':''} ${busy?'generating':''}`}>
                {candidates.map(c=><article key={c.id} className={`candidate-card review-card ${c.status==='accepted'?'is-accepted':''} ${c.status==='rejected'?'is-rejected':''}`}>
                  <div className="card-topline"><span className="direction-letter">{directionLetter(c,candidates)}</span>{c.status==='accepted'?<span className="accepted-label"><Check size={11}/>Accepted</span>:c.status==='rejected'?<span className="rejected-label"><X size={11}/>Rejected</span>:<span className="card-source">{c.source==='ai'?'AI DIRECTION':c.source==='demo'?'DEMO':c.source==='edited'?'EDITED':'SVG'}</span>}</div>
                  <button className="icon-canvas" onClick={()=>setInspect(c)} aria-label={`Preview ${c.name}`}><SvgPreview svg={c.svg} size={size} standards={standards} showGuides={showConstructionGuides}/></button>
                  <div className="candidate-caption"><strong>{c.name}</strong>{c.treatment&&<em className="treatment-badge">{versionLabel(c)}</em>}</div>
                  <div className="candidate-actions"><button disabled={!!busy} className={c.status==='accepted'?'accepted-action':''} aria-pressed={c.status==='accepted'} aria-label={`${c.status==='accepted'?'Undo acceptance of':'Accept'} ${c.name}`} onClick={()=>setCandidateStatus(c.id,'accepted')}><Check size={13}/>{c.status==='accepted'?'Accepted':'Accept'}</button><button disabled={!!busy} className={c.status==='rejected'?'rejected-action':''} aria-pressed={c.status==='rejected'} aria-label={`${c.status==='rejected'?'Undo rejection of':'Reject'} ${c.name}`} onClick={()=>setCandidateStatus(c.id,'rejected')}><X size={13}/>{c.status==='rejected'?'Rejected':'Reject'}</button></div>
                </article>)}
              </div>

              <div className="canvas-caption"><span><Check size={13}/>Accept or reject directions. Click an icon to inspect and edit it.</span><span>SMALL DETAILS. BIG DIFFERENCE.</span></div>
            </>}
            {(isNew||!active)&&<div className="new-icon-empty"><div className="empty-icon-pile"><Grid2X2/><Sparkles/><Layers2/></div><strong>A little description. A world of directions.</strong><p>Tell us what it’s for. Your style standards will do the rest.</p><div className="prompt-chips">{['A folder for saved projects','A bell for notifications','A heart for favorites'].map(p=><button key={p} onClick={()=>changeBrief(p)}>{p}<Plus size={12}/></button>)}</div></div>}
          </>}
        </div>

        <div className="export-dock workspace-utility-dock" role="region" aria-label="Preview and export controls">
          <PreviewBackgroundToggle dark={darkCanvas} onToggle={()=>setDarkCanvas(value=>!value)}/>
          {acceptedSvgCount>0&&<div className="workspace-export-controls"><span className="workspace-accepted-count">{acceptedSvgCount} accepted {acceptedSvgCount===1?'SVG':'SVGs'}</span><button className="button primary" onClick={downloadSet}><ArrowDownToLine size={16}/>Export set<span className="button-count">{acceptedSvgCount}</span></button></div>}
        </div>
      </main>

      <aside className={`standards-panel compact-standards-panel ${mobilePanel==='standards'?'mobile-open':''}`}>
        <div className="panel-heading"><span><SlidersHorizontal size={17}/><strong>Your standards</strong></span><span className="live-indicator"/></div><p className="panel-subtitle">One system for every icon.</p>
        <StandardsControls standards={standards} onChange={updateStandards} creativity={creativity} onCreativityChange={setCreativity} disabled={!!busy} count={count} canFit={items.some(item=>item.candidates.some(candidate=>candidate.svg!==item.originalSvg))} fitting={busy==='fit'} onFit={()=>void fitExistingDesigns()}/>
        <div className="standard-actions compact-standards-actions"><p>Grid and stroke update live. Other settings guide new designs.</p><button className="text-button tertiary" onClick={()=>{const name=`${standards.colorMode!=='mono'?'Color':'Mono'} · ${standards.corner==='square'?'Rough':'Rounded'} · ${standards.style==='duotone'?'Color':standards.style==='line'?'Outlined':standards.style[0].toUpperCase()+standards.style.slice(1)} · ${standards.proportion==='square'?'1:1':'Natural'} · ${GRID_LABELS[standards.constructionGrid||'none']} · ${standards.perspective==='isometric'?'Isometric':'Face-on'} · ${standards.strokeWidth}u · R${standards.corner==='square'?0:standards.cornerRadius??1} · ${standards.gridSize}×${standards.gridSize}`;setPresets(p=>[...p.filter(x=>x.name!==name),{name,standards:{...standards}}].slice(-8));notice('Preset saved on this device.');}}><Plus size={13}/>Save as a preset</button>{presets.length>0&&<StudioSelect size="sm" label="Load standards preset" placeholder="Load a saved preset…" value="" disabled={!!busy} onValueChange={value=>{const p=presets.find(p=>p.name===value);if(p){updateStandards({...DEFAULT_STANDARDS,...p.standards,colorMode:p.standards.colorMode??(p.standards.style==='duotone'?'duo':'mono'),style:p.standards.style==='duotone'?'filled':p.standards.style});notice('Preset loaded. Canvas grid and stroke weight updated; other settings guide your next generation.');}}} options={presets.map(p=>({value:p.name,label:p.name}))}/>}</div>
      </aside>
    </div>
    <input ref={fileRef} type="file" accept=".svg,image/svg+xml" multiple hidden onChange={e=>void upload(e.target.files)}/>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={13}/></button></div>}

    {editing&&<VectorEditor darkCanvas={darkCanvas} onToggleDarkCanvas={()=>setDarkCanvas(value=>!value)} standards={standards} svg={editing.candidate.svg} name={items.find(i=>i.id===editing.itemId)?.name||editing.candidate.name} onSave={saveVectorEdit} onClose={()=>setEditing(null)}/>}
    {(modal||inspect)&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){connectionController.current?.abort();setModal(null);setInspect(null);}}}><div ref={dialogRef} className={`modal ${inspect?'inspect-modal':''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close icon-button" aria-label="Close dialog" onClick={()=>{connectionController.current?.abort();setModal(null);setInspect(null);}}><X size={20}/></button>
      {modal==='connect'&&<><span className="modal-icon"><KeyRound size={25}/></span><div className="eyebrow">LLM API SETTINGS</div><h2 id="modal-title">Your AI connection</h2><p>Choose a model and connect your OpenAI key. You can remember it on this browser.</p>{connected&&<div className="ai-generation-setting"><label><input type="checkbox" checked={useAI} disabled={!!busy||connectionBusy||forgettingKey} onChange={e=>setUseAI(e.target.checked)}/><span>Use AI for new designs</span></label><p>Switch off for demo previews. Redesigns, refinements, and isometric designs always use AI. Your saved key stays connected.</p></div>}<label className="field-label" htmlFor="api-key">OpenAI API key</label><input id="api-key" className="text-input" type="password" autoComplete="off" value={keyDraft} disabled={connectionBusy} onChange={e=>{setKeyDraft(e.target.value);setConnectionError('');}} placeholder={connected?'An AI connection is already active':'sk-…'}/><label className="field-label" htmlFor="model-name">Model</label><div className="model-presets" role="group" aria-label="Choose an AI model">{[{id:'gpt-6-astra',name:'GPT-6 Astra',detail:'Most capable · Higher cost'},{id:'gpt-6.1-sol',name:'GPT-6.1 Sol',detail:'Balanced · Lower cost'}].map(option=><button key={option.id} type="button" disabled={connectionBusy||!!busy} aria-pressed={model===option.id} className={model===option.id?'chosen':''} onClick={()=>{setModel(option.id);setConnectionVerified(false);setConnectionError('');}}><strong>{option.name}</strong><span>{option.detail}</span></button>)}</div><input id="model-name" className="text-input" value={model} disabled={connectionBusy||!!busy} maxLength={80} onChange={e=>{setModel(e.target.value);setConnectionVerified(false);setConnectionError('');}} placeholder="Default model"/><p className="model-help">Your model choice is remembered. Verify access with your OpenAI key before generating.{model==='gpt-6-astra'&&<> Astra costs more per token than Sol. <a href="https://developers.openai.com/api/docs/models/gpt-6-astra" target="_blank" rel="noreferrer">View model details ↗</a></>}</p>{keySaved&&!keyDraft.trim()?<div className="remembered-key-status"><ShieldCheck size={17}/><span><strong>Key remembered on this browser</strong><small>Your connection survives refreshes. Use Forget key to remove it.</small></span></div>:<div className="remember-key-setting"><label><input type="checkbox" checked={rememberKey} disabled={!rememberAvailable||connectionBusy||forgettingKey} onChange={e=>setRememberKey(e.target.checked)}/><span>Remember my key</span></label><p>{rememberAvailable?'Encrypted and saved for 30 days on this browser.':'Remembering keys is unavailable on this instance.'}</p></div>}<div className="privacy-note"><ShieldCheck size={17}/><span>{rememberKey?'iconoklast.app encrypts your key in a private browser cookie that only the server can read. It is kept out of your workspace and page storage.':'Without Remember my key, your token stays in this tab’s memory and clears on refresh.'} Usage is billed to your OpenAI account.</span></div>{serverConfigured&&<div className="connection-notice"><Check size={14}/>A server connection is configured.</div>}{connectionError&&<div className="message error" role="alert">{connectionError}</div>}<button className="button primary full" disabled={connectionBusy||forgettingKey||(!keyDraft.trim()&&!connected)} onClick={connectAI}>{connectionBusy?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {connectionBusy?'Checking key and model…':rememberKey&&!keySaved?'Verify and save key':'Verify and connect'}</button>{connected&&<button className="text-button disconnect" disabled={connectionBusy||forgettingKey} onClick={forgetAIKey}>{forgettingKey?'Forgetting key…':keySaved?'Forget key & use demo mode':'Clear token & use demo mode'}</button>}<small className="modal-small">{keySaved?'Your saved key is encrypted and expires after 30 days.':'Choose Remember my key before connecting to keep it after refresh.'} Your uploaded icons and designs stay on this device.</small></>}
      {modal==='help'&&<><span className="modal-icon"><Sparkles size={26}/></span><div className="eyebrow">Welcome to iconoklast.app</div><h2 id="modal-title">A family of icons.<br/>A process that feels natural.</h2><div className="help-steps"><div><b>01</b><span><strong>Define your visual language</strong>Pick a style, weight, canvas, corners, and palette.</span></div><div><b>02</b><span><strong>Create or bring your own</strong>Write an icon brief, or upload a set of SVG files.</span></div><div><b>03</b><span><strong>Explore. Choose. Refine.</strong>Compare alternatives, accept or reject directions, and approve suggested rules for your next round.</span></div><div><b>04</b><span><strong>Take your icons anywhere</strong>Export accepted icons as SVG. Your workspace saves automatically in this browser.</span></div></div><button className="button primary full" onClick={()=>setModal(null)}>Let’s make something<ArrowRight size={16}/></button></>}
      {modal==='history'&&<><span className="modal-icon"><History size={26}/></span><h2 id="modal-title">Room to explore.</h2><p>Every previous round stays here. Restore a direction whenever you need it.</p><div className="history-list">{active?.revisions?.length?([...active.revisions].reverse()).map((r,idx)=><div className="history-item" key={idx}><div className="history-thumbs">{r.candidates.slice(0,3).map(c=><SvgPreview key={c.id} svg={c.svg} size={28}/>)}</div><span><strong>Round {r.round}</strong><small>{r.candidates.length} directions · {r.standards.style}</small></span><button className="button secondary" onClick={()=>restoreRevision(r)}>Restore</button></div>):<div className="empty-history">Your next generation will save this round here.</div>}</div></>}
      {inspect&&<><div className="eyebrow">A CLOSER LOOK</div><div className="inspect-title-row"><h2 id="modal-title">{inspect.name}</h2><button className="button primary" disabled={!!busy} onClick={()=>openEditor(inspect)}><PenTool size={15}/>Edit icon</button></div>{inspect.treatment&&<span className="treatment-badge">{versionLabel(inspect)}</span>}<div className={`inspect-canvas ${darkCanvas?'dark-canvas':''}`}><SvgPreview svg={inspect.svg} size={200} standards={standards} showGuides={showConstructionGuides}/></div>{inspectedCanvas&&<p className="inspect-unit-caption">{inspectedCanvas.width} × {inspectedCanvas.height} grid · 1 square = 1 unit = 1 export pixel</p>}<div className="inspect-grid-actions"><PreviewBackgroundToggle dark={darkCanvas} onToggle={()=>setDarkCanvas(value=>!value)}/><label className="inspect-guide-toggle"><input type="checkbox" checked={showConstructionGuides} onChange={e=>setShowConstructionGuides(e.target.checked)}/>Show construction guides</label><button className="button secondary" disabled={!!busy||items.some(item=>item.originalSvg===inspect.svg)} onClick={()=>void fitExistingDesigns(standards,inspect.id)}>{busy==='fit'?<LoaderCircle size={14} className="spin"/>:<Maximize2 size={14}/>}Fit to {artworkSpan} × {artworkSpan}</button></div><p className="inspect-fit-target">{artworkFit.mode==='keyline'?'Keyline target':'Custom target'}: <strong>{artworkSpan} × {artworkSpan} u</strong> · Padding {artworkPadding} u · Stroke {standards.strokeWidth} u</p>{fitFeedback&&(!fitFeedback.candidateId||fitFeedback.candidateId===inspect.id)&&<p className={`inspect-fit-feedback${fitFeedback.error?' error':''}`} role={fitFeedback.error?'alert':'status'}>{fitFeedback.message}</p>}<IconMetrics svg={inspect.svg} targetSquare={standards.proportion==='square'}/><div className="inspect-design-notes"><strong>Design notes</strong><p>{inspect.rationale||'Review this direction against your brief and session rules.'}</p></div><div className={`inspect-sizes ${darkCanvas?'dark-previews':''}`}>{[16,24,32,48].map(n=><div key={n}><SvgPreview svg={inspect.svg} size={n}/><span>{n}px</span></div>)}</div><div className="modal-buttons"><button className="button secondary" onClick={()=>{navigator.clipboard.writeText(inspect.svg).then(()=>notice('SVG copied to your clipboard.')).catch(()=>notice('Clipboard unavailable. Download the SVG instead.'));}}><Copy size={15}/>Copy SVG</button><button className="button primary" onClick={()=>exportSvg(inspect.svg,candidateFileName(active?.name||inspect.name,inspect))}><Download size={15}/>Download SVG</button></div><details className="svg-code"><summary>View SVG source<FileCode2 size={14}/></summary><pre>{inspect.svg}</pre></details></>}
    </div></div>}
  </div>;
}
