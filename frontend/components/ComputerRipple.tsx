import { useEffect, useRef, useSyncExternalStore } from 'react';
import { composerState } from './composer-state';
import { fragmentShader } from './computer-ripple-shader';

export default function ComputerRipple() {
    const {computer} = useSyncExternalStore(composerState.subscribe, composerState.get, composerState.server);
    const canvas=useRef<HTMLCanvasElement>(null);
    useEffect(()=>{
        const element=canvas.current, motion=matchMedia('(prefers-reduced-motion: reduce)');
        if(!element||!computer||motion.matches) return;
        const page=element.closest('.computer-page');
        if(page?.classList.contains('has-conversation')) return;
        const gl=element.getContext('webgl2',{alpha:true,antialias:false,powerPreference:'low-power'});
        if(!gl)return;
        const program=gl.createProgram(),buffer=gl.createBuffer(),texture=gl.createTexture();
        if(!program||!buffer||!texture)return;
        const shaders:WebGLShader[]=[];
        const destroy=()=>{gl.deleteBuffer(buffer);gl.deleteTexture(texture);gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));};
        for(const [type,source] of [[gl.VERTEX_SHADER,'#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'],[gl.FRAGMENT_SHADER,fragmentShader]] as const){
            const shader=gl.createShader(type);if(!shader)continue;shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);gl.attachShader(program,shader);
        }
        gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS)){destroy();return;}
        gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
        const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const names=['u_size','u_tint','u_rippleOrigin','u_glyphAtlas','u_progress','u_pixelRatio','u_maskRect','u_maskRadius'];
        const uniform=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));
        const atlas=document.createElement('canvas');atlas.width=224;atlas.height=32;
        const ctx=atlas.getContext('2d');if(!ctx){destroy();return;}
        ctx.fillStyle='white';ctx.font='200 18px ui-monospace, SFMono-Regular, Menlo, monospace';ctx.textAlign='center';ctx.textBaseline='middle';
        ['+','/','=',':','>','0','1'].forEach((glyph,index)=>ctx.fillText(glyph,(index+.5)*32,16));
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(uniform.u_glyphAtlas,0);
        const color=(getComputedStyle(element).color.match(/[\d.]+/g)||['255','255','255']).map(Number);
        gl.uniform3f(uniform.u_tint,color[0]/255,color[1]/255,color[2]/255);
        let frame=0,start=0,last=-Infinity;
        const clear=()=>{cancelAnimationFrame(frame);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);element.dataset.running='false';};
        const draw=(now:number)=>{
            if(document.hidden||motion.matches||page?.classList.contains('has-conversation')){clear();return;}
            start ||= now;const elapsed=now-start;
            if(elapsed>=2200){clear();return;}
            frame=requestAnimationFrame(draw);if(elapsed-last<1000/30)return;last=elapsed;
            const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)return;
            const ratio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1500000/(rect.width*rect.height)));
            element.width=Math.floor(rect.width*ratio);element.height=Math.floor(rect.height*ratio);gl.viewport(0,0,element.width,element.height);
            const logo=page?.querySelector('.computer-intro__animated-logo')?.getBoundingClientRect();
            const origin=logo?.width && logo.height ? logo : page?.querySelector('#computer-title')?.getBoundingClientRect();
            gl.uniform2f(uniform.u_size,element.width,element.height);gl.uniform1f(uniform.u_pixelRatio,ratio);
            gl.uniform2f(uniform.u_rippleOrigin,origin?.width?((origin.left+origin.width/2-rect.left)/rect.width):.5,origin?.height?((origin.top+origin.height/2-rect.top)/rect.height):.35);
            const mask=page?.querySelector('.home__composer')?.getBoundingClientRect();
            if(mask)gl.uniform4f(uniform.u_maskRect,(mask.left-rect.left-1)*ratio,(mask.top-rect.top-1)*ratio,(mask.right-rect.left+1)*ratio,(mask.bottom-rect.top+1)*ratio);
            gl.uniform1f(uniform.u_maskRadius,25*ratio);gl.uniform1f(uniform.u_progress,elapsed/2200);
            gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        };
        element.dataset.running='true';frame=requestAnimationFrame(draw);
        document.addEventListener('visibilitychange',clear);motion.addEventListener('change',clear);
        return()=>{clear();document.removeEventListener('visibilitychange',clear);motion.removeEventListener('change',clear);destroy();};
    },[computer]);
    return <canvas ref={canvas} className="computer-ripple" aria-hidden="true"/>;
}
