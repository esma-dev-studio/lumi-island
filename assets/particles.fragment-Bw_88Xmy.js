import{ai as r}from"./index-hJbJKOQw.js";import"./CharacterView-B7aW6TBd.js";import"./logDepthFragment-Dyw__oC4.js";import"./logDepthDeclaration-bVSmio3E.js";import"./helperFunctions-DQdjroPs.js";import"./fogFragment-DKH-P_fj.js";import"./passPostProcess-DnvwaviU.js";import"./texture-B8mlni0h.js";import"./tools-CHKs65jJ.js";import"./environmentTextureTools-BrGG1YHi.js";import"./dumpTools-D6kemKJH.js";import"./abstractEngine.cubeTexture-biid4Oxz.js";import"./workerPool-CfMXSLnf.js";const e="particlesPixelShader",a=`#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
varying vec2 vUV;varying vec4 vColor;uniform vec4 textureMask;uniform sampler2D diffuseSampler;
#include<clipPlaneFragmentDeclaration>
#include<imageProcessingDeclaration>
#include<logDepthDeclaration>
#include<helperFunctions>
#include<imageProcessingFunctions>
#ifdef RAMPGRADIENT
varying vec4 remapRanges;uniform sampler2D rampSampler;
#endif
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec4 textureColor=texture2D(diffuseSampler,vUV);vec4 baseColor=(textureColor*textureMask+(vec4(1.,1.,1.,1.)-textureMask))*vColor;
#ifdef RAMPGRADIENT
float alpha=baseColor.a;float remappedColorIndex=clamp((alpha-remapRanges.x)/remapRanges.y,0.0,1.0);vec4 rampColor=texture2D(rampSampler,vec2(1.0-remappedColorIndex,0.));baseColor.rgb*=rampColor.rgb;float finalAlpha=baseColor.a;baseColor.a=clamp((alpha*rampColor.a-remapRanges.z)/remapRanges.w,0.0,1.0);
#endif
#ifdef BLENDMULTIPLYMODE
float sourceAlpha=vColor.a*textureColor.a;baseColor.rgb=baseColor.rgb*sourceAlpha+vec3(1.0)*(1.0-sourceAlpha);
#endif
#include<logDepthFragment>
#include<fogFragment>(color,baseColor)
#ifdef IMAGEPROCESSINGPOSTPROCESS
baseColor.rgb=toLinearSpace(baseColor.rgb);
#else
#ifdef IMAGEPROCESSING
baseColor.rgb=toLinearSpace(baseColor.rgb);baseColor=applyImageProcessing(baseColor);
#endif
#endif
gl_FragColor=baseColor;
#define CUSTOM_FRAGMENT_MAIN_END
}`;r.ShadersStore[e]||(r.ShadersStore[e]=a);const u={name:e,shader:a};export{u as particlesPixelShader};
