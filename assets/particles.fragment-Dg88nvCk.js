import{al as r}from"./index-B4ua3-lf.js";import"./CharacterView-BCyawp4l.js";import"./logDepthFragment-BKrZQHVw.js";import"./logDepthDeclaration-BzXr00Qo.js";import"./helperFunctions-vYCBe0au.js";import"./fogFragment-CJ6OA-e8.js";import"./passPostProcess-PnUdLn1A.js";import"./texture-DmiDufKd.js";import"./tools-BIPlzgTJ.js";import"./environmentTextureTools-C2wb1bUU.js";import"./dumpTools-Bsa6LA_T.js";import"./abstractEngine.cubeTexture-DIrJjG3r.js";import"./workerPool-CfMXSLnf.js";const e="particlesPixelShader",a=`#ifdef LOGARITHMICDEPTH
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
