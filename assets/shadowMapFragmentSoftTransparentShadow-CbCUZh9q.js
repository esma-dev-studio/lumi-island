import{a9 as r}from"./index-Bs_pq66_.js";const a="shadowMapFragmentSoftTransparentShadow",o=`#if SM_SOFTTRANSPARENTSHADOW==1
if ((bayerDither8(floor(((fragmentInputs.position.xy)%(8.0)))))/64.0>=uniforms.softTransparentShadowSM.x*alpha) {discard;}
#endif
`;r.IncludesShadersStoreWGSL[a]||(r.IncludesShadersStoreWGSL[a]=o);const t={name:a,shader:o};export{t as shadowMapFragmentSoftTransparentShadowWGSL};
