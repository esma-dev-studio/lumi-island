import{ai as i}from"./index-hJbJKOQw.js";import"./CharacterView-B7aW6TBd.js";import"./fogVertex-BhOq-9Mr.js";import"./vertexColorMixing-D61MOvLF.js";import"./passPostProcess-DnvwaviU.js";import"./texture-B8mlni0h.js";import"./tools-CHKs65jJ.js";import"./environmentTextureTools-BrGG1YHi.js";import"./dumpTools-D6kemKJH.js";import"./abstractEngine.cubeTexture-biid4Oxz.js";import"./workerPool-CfMXSLnf.js";const e="colorVertexShader",o=`attribute vec3 position;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform mat4 view;
#endif
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vec4 vColor;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
vec4 colorUpdated=color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(position,1.0);
#ifdef MULTIVIEW
if (gl_ViewID_OVR==0u) {gl_Position=viewProjection*worldPos;} else {gl_Position=viewProjectionR*worldPos;}
#else
gl_Position=viewProjection*worldPos;
#endif
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;i.ShadersStore[e]||(i.ShadersStore[e]=o);const E={name:e,shader:o};export{E as colorVertexShader};
