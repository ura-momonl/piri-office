export async function fetchExtraResets({ now = new Date() } = {}) { return { checked_at: now.toISOString(), sources: [] }; }

export function accountResetMessages(result,checked_at=new Date().toISOString()){
  return {checked_at,feature_enabled:result?.featureEnabled===true,
    messages:(Array.isArray(result?.messages)?result.messages:[]).filter(m=>!m.archivedAt&&/reset|重置|额度|usage/i.test(m.messageBody||''))
      .slice(0,5).map(m=>({text:String(m.messageBody).slice(0,1000),created_at:Number.isFinite(m.createdAt)?new Date(m.createdAt*1000).toISOString():null}))};
}
