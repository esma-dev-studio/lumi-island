import{aS as o}from"./index-Cz9f9I8C.js";import"./CharacterView-CSPJ8uUk.js";import"./fogFragment-DZsC2I8M.js";import"./passPostProcess-L9k_tDaV.js";import"./texture-PBgsID4I.js";import"./tools-BCoPGuiT.js";import"./environmentTextureTools-DHPxCj_N.js";import"./dumpTools-CBWJxpzi.js";import"./abstractEngine.cubeTexture-MDdJy0WF.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
