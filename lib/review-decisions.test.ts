import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewDecision, ruleLearningFingerprint } from './review-decisions.ts';
import { emptySessionRules } from './session-rules.ts';
import type { IconItem, Standards } from './icon-types.ts';

const standards = { style:'line',strokeWidth:1.5,gridSize:24,corner:'round',primaryColor:'#252331',secondaryColor:'#7254d4',padding:2 } as Standards;
const item = ():IconItem => ({id:'session-a',name:'Folder',brief:'A saved folder',round:1,sessionRules:emptySessionRules(),candidates:['a','b'].map(id=>({id,name:id,svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>',rationale:'Simple shape',source:'ai',status:'pending'}))});

test('decisions are reversible, preserve SVGs, and supersede previous feedback',()=>{
  const source=item();
  const rejected=applyReviewDecision(source,'a','rejected');
  assert.equal(rejected.candidates[0].status,'rejected');
  assert.equal(rejected.candidates[0].svg,source.candidates[0].svg);
  assert.equal(rejected.sessionRules?.feedback[0].decision,'rejected');
  const accepted=applyReviewDecision(rejected,'a','accepted');
  assert.equal(accepted.sessionRules?.feedback.length,1);
  assert.equal(accepted.sessionRules?.feedback[0].decision,'accepted');
  const undone=applyReviewDecision(accepted,'a','accepted');
  assert.equal(undone.candidates[0].status,'pending');
  assert.equal(undone.sessionRules?.feedback.length,0);
  assert.deepEqual(source.sessionRules,emptySessionRules());
});

test('replacing the accepted direction removes its obsolete preference and pending suggestions',()=>{
  const first=applyReviewDecision(item(),'a','accepted');
  first.sessionRules!.suggestions=[{id:'s',text:'Prefer a single square.',reason:'Observed geometry',evidenceIds:['a']}];
  const second=applyReviewDecision(first,'b','accepted');
  assert.equal(second.candidates[0].status,'pending');
  assert.equal(second.candidates[1].status,'accepted');
  assert.deepEqual(second.sessionRules?.feedback.map(value=>value.candidateId),['b']);
  assert.equal(second.sessionRules?.suggestions.length,0);
});

test('paired accepted treatments coexist and rules stay scoped to their item',()=>{
  const first=item();
  first.candidates=first.candidates.map((candidate,index)=>({...candidate,pairId:'pair',treatment:index?'filled':'line'}));
  const other=item();other.id='session-b';
  const accepted=applyReviewDecision(applyReviewDecision(first,'a','accepted'),'b','accepted');
  assert.equal(accepted.candidates.filter(candidate=>candidate.status==='accepted').length,2);
  assert.equal(other.sessionRules?.feedback.length,0);
});

test('learning fingerprint rejects stale decisions, rules, brief and standards while ignoring proposal presentation',()=>{
  const source=applyReviewDecision(item(),'a','accepted');
  const fingerprint=ruleLearningFingerprint(source,standards);
  source.sessionRules!.suggestions=[{id:'s',text:'Prefer simple shapes.',reason:'Test',evidenceIds:['a']}];
  assert.equal(ruleLearningFingerprint(source,standards),fingerprint);
  assert.notEqual(ruleLearningFingerprint({...source,brief:'A new subject'},standards),fingerprint);
  assert.notEqual(ruleLearningFingerprint(source,{...standards,strokeWidth:2}),fingerprint);
  assert.notEqual(ruleLearningFingerprint(applyReviewDecision(source,'a','rejected'),standards),fingerprint);
  source.sessionRules!.rules.push({id:'r',text:'Keep the top open.',source:'manual'});
  assert.notEqual(ruleLearningFingerprint(source,standards),fingerprint);
});
