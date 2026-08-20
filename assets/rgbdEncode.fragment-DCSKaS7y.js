import{al as r}from"./index-B4ua3-lf.js";import"./helperFunctions-CM6YI-RQ.js";const e="rgbdEncodePixelShader",t=`varying vUV: vec2f;var textureSamplerSampler: sampler;var textureSampler: texture_2d<f32>;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {fragmentOutputs.color=toRGBD(textureSample(textureSampler,textureSamplerSampler,input.vUV).rgb);}`;r.ShadersStoreWGSL[e]||(r.ShadersStoreWGSL[e]=t);const S={name:e,shader:t};export{S as rgbdEncodePixelShaderWGSL};
