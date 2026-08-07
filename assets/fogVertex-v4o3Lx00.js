import{ag as e}from"./index-DVtpSKyF.js";const s="fogVertexDeclaration",o=`#ifdef FOG
varying vFogDistance: vec3f;
#endif
`;e.IncludesShadersStoreWGSL[s]||(e.IncludesShadersStoreWGSL[s]=o);const r="fogVertex",t=`#ifdef FOG
#ifdef SCENE_UBO
vertexOutputs.vFogDistance=(scene.view*worldPos).xyz;
#else
vertexOutputs.vFogDistance=(uniforms.view*worldPos).xyz;
#endif
#endif
`;e.IncludesShadersStoreWGSL[r]||(e.IncludesShadersStoreWGSL[r]=t);
