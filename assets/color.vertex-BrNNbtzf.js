import{aS as i}from"./index-Cz9f9I8C.js";import"./CharacterView-CSPJ8uUk.js";import"./fogVertex-nKsgqwql.js";import"./vertexColorMixing-B_LVQpzB.js";import"./passPostProcess-L9k_tDaV.js";import"./texture-PBgsID4I.js";import"./tools-BCoPGuiT.js";import"./environmentTextureTools-DHPxCj_N.js";import"./dumpTools-CBWJxpzi.js";import"./abstractEngine.cubeTexture-MDdJy0WF.js";import"./workerPool-CfMXSLnf.js";const e="colorVertexShader",o=`attribute vec3 position;
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
