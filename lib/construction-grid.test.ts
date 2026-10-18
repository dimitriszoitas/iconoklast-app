import assert from 'node:assert/strict';
import test from 'node:test';
const {getConstructionGuides,describeConstructionGrid,CONSTRUCTION_BASE_SIZE}:typeof import('./construction-grid')=await import(new URL('./construction-grid.ts',import.meta.url).href);

const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} should equal ${expected}`);

test('24-unit keylines have a centered 20×20 circle and square plus 18×20 and 20×18 frames',()=>{
  assert.equal(CONSTRUCTION_BASE_SIZE,24);
  const guides=getConstructionGuides('keyline',24,2);
  const circles=guides.filter(g=>g.type==='circle');
  assert.deepEqual(circles,[{type:'circle',cx:12,cy:12,r:10,role:'major'}]);
  const rectangles=guides.filter(g=>g.type==='rect');
  assert.deepEqual(rectangles.map(g=>({x:g.x,y:g.y,width:g.width,height:g.height})),[
    {x:2,y:2,width:20,height:20},
    {x:3,y:2,width:18,height:20},
    {x:2,y:3,width:20,height:18},
  ]);
});

test('both construction references use one-unit cells and keep all guides inside the artboard',()=>{
  for(const grid of ['keyline','concentric'] as const) for(const size of [16,24,32,48]) {
    const guides=getConstructionGuides(grid,size,2);
    const minorLines=guides.filter(g=>g.type==='line').filter(g=>g.role==='minor');
    const coordinates=Array.from({length:size+1},(_,i)=>i);
    assert.equal(minorLines.length,2*(size+1));
    assert.deepEqual(minorLines.filter(g=>g.x1===g.x2).map(g=>g.x1),coordinates);
    assert.deepEqual(minorLines.filter(g=>g.y1===g.y2).map(g=>g.y1),coordinates);
    for(const g of guides) {
      const points=g.type==='line'?[g.x1,g.y1,g.x2,g.y2]:g.type==='circle'?[g.cx-g.r,g.cy-g.r,g.cx+g.r,g.cy+g.r]:[g.x,g.y,g.x+g.width,g.y+g.height];
      assert.ok(points.every(value=>value>=0&&value<=size));
    }
    const majorLines=guides.filter(g=>g.type==='line').filter(g=>g.role==='major');
    assert.ok(majorLines.some(g=>g.x1===size/2&&g.x2===size/2));
    assert.ok(majorLines.some(g=>g.y1===size/2&&g.y2===size/2));
    assert.ok(majorLines.some(g=>g.x1===0&&g.y1===0&&g.x2===size&&g.y2===size));
    assert.ok(majorLines.some(g=>g.x1===size&&g.y1===0&&g.x2===0&&g.y2===size));
  }
});

test('guide frames scale proportionally across canvas sizes, independently of optical padding',()=>{
  for(const grid of ['keyline','concentric'] as const) for(const size of [16,24,32,48]) {
    const reference=getConstructionGuides(grid,24,2).filter(g=>g.type!=='line');
    const scaled=getConstructionGuides(grid,size,2).filter(g=>g.type!=='line');
    assert.equal(reference.length,scaled.length);
    for(let i=0;i<reference.length;i++) {
      const source=reference[i],target=scaled[i];
      assert.equal(target.type,source.type);
      if(source.type==='circle'&&target.type==='circle') {
        near(target.cx,size/2);near(target.cy,size/2);near(target.r,source.r*size/24);
      } else if(source.type==='rect'&&target.type==='rect') {
        near(target.width,source.width*size/24);near(target.height,source.height*size/24);near(target.rx,source.rx*size/24);
        near(target.x+target.width/2,size/2);near(target.y+target.height/2,size/2);
      }
    }
    for(const padding of [0,2,4]) assert.deepEqual(getConstructionGuides(grid,size,padding),getConstructionGuides(grid,size,2));
  }
});

test('concentric reference uses a 20×20 boundary and outer circle with proportionate inner circles',()=>{
  const guides=getConstructionGuides('concentric',24,3);
  const circles=guides.filter(g=>g.type==='circle');assert.equal(circles.length,3);
  assert.ok(circles.every(g=>g.cx===12&&g.cy===12));
  assert.equal(circles[0].r,10);
  near(circles[1].r/circles[0].r,.263/.435);
  near(circles[2].r/circles[0].r,.187/.435);
  const boundary=guides.find(g=>g.role==='boundary');assert.ok(boundary&&boundary.type==='rect');
  assert.equal(boundary.x,2);assert.equal(boundary.y,2);assert.equal(boundary.width,20);assert.equal(boundary.height,20);
});

test('AI construction instructions match the visible dimensions and separate padding from the grid',()=>{
  const prompt=describeConstructionGrid('keyline',24,4);
  assert.match(prompt,/24×24 cells: 1 pixel = 1 SVG unit = 1 grid square/);
  assert.match(prompt,/viewBox="0 0 24 24" and width="24" height="24"/);
  assert.match(prompt,/20×20 outer circle and square, an 18×20 vertical rectangle and a 20×18 horizontal rectangle/);
  assert.match(prompt,/circle center \(12,12\), radius 10/);
  assert.match(prompt,/rectangle x=3, y=2, width=18, height=20/);
  assert.match(prompt,/rectangle x=2, y=3, width=20, height=18/);
  assert.match(prompt,/Optical padding is separately set to 4 canvas units/);
  assert.match(prompt,/changing it does not resize the grid or guide shapes/);
  assert.match(prompt,/Fractional coordinates are allowed for Bézier control points/);
  assert.match(prompt,/must not produce a tall\/wide final silhouette/);
  assert.match(prompt,/Never export the grid/);
  const larger=describeConstructionGrid('concentric',48,4);
  assert.match(larger,/48×48 cells/);
  assert.match(larger,/viewBox="0 0 48 48" and width="48" height="48"/);
  assert.match(larger,/circle center \(24,24\), radius 20/);
  assert.match(larger,/rectangle x=4, y=4, width=40, height=40/);
});

test('none produces no guides; invalid settings fail instead of corrupting coordinates',()=>{
  assert.deepEqual(getConstructionGuides('none'),[]);
  assert.match(describeConstructionGrid('none'),/No construction grid/);
  assert.throws(()=>getConstructionGuides('keyline',24,12));
  assert.throws(()=>getConstructionGuides('concentric',NaN,2));
  assert.throws(()=>getConstructionGuides('keyline',24.5,2));
});
