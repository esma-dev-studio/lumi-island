import{ai as o}from"./index-hJbJKOQw.js";import"./CharacterView-B7aW6TBd.js";import"./fogFragment-DKH-P_fj.js";import"./passPostProcess-DnvwaviU.js";import"./texture-B8mlni0h.js";import"./tools-CHKs65jJ.js";import"./environmentTextureTools-BrGG1YHi.js";import"./dumpTools-D6kemKJH.js";import"./abstractEngine.cubeTexture-biid4Oxz.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
#define VERTEXCOLOR
varying vec4 vColor;
#else
uniform vec4 color;
#endif
#include<clipPlaneFragmentDeclaration>
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
gl_FragColor=vColor;
#else
gl_FragColor=color;
#endif
#include<fogFragment>(color,gl_FragColor)
#define CUSTOM_FRAGMENT_MAIN_END
}`;o.ShadersStore[e]||(o.ShadersStore[e]=r);const C={name:e,shader:r};export{C as colorPixelShader};
