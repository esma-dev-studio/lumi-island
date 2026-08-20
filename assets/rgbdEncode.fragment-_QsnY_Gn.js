import{bL as r}from"./index-B4fQvQnx.js";import"./helperFunctions-Dcu22mB7.js";const e="rgbdEncodePixelShader",o=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=toRGBD(texture2D(textureSampler,vUV).rgb);}`;r.ShadersStore[e]||(r.ShadersStore[e]=o);const d={name:e,shader:o};export{d as rgbdEncodePixelShader};
