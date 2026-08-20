import{aS as r}from"./index-Cz9f9I8C.js";import"./helperFunctions-_o330Opt.js";const e="rgbdDecodePixelShader",o=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=vec4(fromRGBD(texture2D(textureSampler,vUV)),1.0);}`;r.ShadersStore[e]||(r.ShadersStore[e]=o);const d={name:e,shader:o};export{d as rgbdDecodePixelShader};
