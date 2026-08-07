import{al as o}from"./index-B4ua3-lf.js";import"./CharacterView-BCyawp4l.js";import"./fogFragment-CJ6OA-e8.js";import"./passPostProcess-PnUdLn1A.js";import"./texture-DmiDufKd.js";import"./tools-BIPlzgTJ.js";import"./environmentTextureTools-C2wb1bUU.js";import"./dumpTools-Bsa6LA_T.js";import"./abstractEngine.cubeTexture-DIrJjG3r.js";import"./workerPool-CfMXSLnf.js";const e="colorPixelShader",r=`#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
