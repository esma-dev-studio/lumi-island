import{ab as o}from"./index-D1FzIJfj.js";import"./CharacterView-BjJK0v7t.js";import"./fogFragment-CXzdFWar.js";import"./passPostProcess-Ck06x78S.js";import"./texture-DIrAwxye.js";import"./tools-Bw7UVvt3.js";import"./environmentTextureTools-CvMafdrA.js";import"./dumpTools-CUoBtSEx.js";import"./abstractEngine.cubeTexture-DkZIBHSe.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
