/** Give the model the visible icon as well as its editable vector geometry. */
export async function renderReferenceImages(references: string[]): Promise<string[]> {
  return Promise.all(references.slice(0,4).map(svg=>new Promise<string>((resolve,reject)=>{
    const img=new Image();
    const timer=setTimeout(()=>{img.onload=null;img.onerror=null;reject(new Error('Could not prepare the reference preview. Try a simpler SVG.'));},8000);
    img.onload=()=>{
      clearTimeout(timer);
      try {
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
        const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not prepare the icon preview.');
        context.fillStyle='#e8e8ec';context.fillRect(0,0,256,256);
        // A quiet checkerboard keeps white and dark source artwork visible.
        context.fillStyle='#c7c7cf';
        for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16)if((x/16+y/16)%2===0)context.fillRect(x,y,16,16);
        const ratio=img.naturalWidth/Math.max(1,img.naturalHeight);const w=ratio>=1?224:224*ratio;const h=ratio>=1?224/ratio:224;
        context.drawImage(img,(256-w)/2,(256-h)/2,w,h);
        resolve(canvas.toDataURL('image/png'));
      } catch(error){reject(error);}
    };
    img.onerror=()=>{clearTimeout(timer);reject(new Error('The source SVG could not be rendered for AI analysis.'));};
    img.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  })));
}
