/* Retry transient Railway gateway failures for same-origin API calls.
   This softens short deployment/network interruptions; it cannot make a
   volume-backed Railway deployment zero-downtime. */
(function(root,factory){
  const createRetryFetch=factory;
  if(typeof module==="object"&&module.exports) module.exports={createRetryFetch};
  else root.apiFetch=createRetryFetch(root.fetch.bind(root));
})(typeof window!=="undefined"?window:globalThis,function createRetryFetch(fetchImpl,wait){
  const pause=wait||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  return async function apiFetch(input,options={}){
    const url=typeof input==="string"?input:(input&&input.url)||"";
    if(!url.startsWith("/api/")) return fetchImpl(input,options);
    const attempts=4;
    for(let attempt=0;attempt<attempts;attempt++){
      const attemptOptions={...options};
      if(attempt>0&&options.signal&&typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"){
        attemptOptions.signal=AbortSignal.timeout(15000);
      }
      try{
        const response=await fetchImpl(input,attemptOptions);
        if(![502,503,504].includes(response.status)||attempt===attempts-1)return response;
        const retryAfter=Number(response.headers&&response.headers.get&&response.headers.get("retry-after"));
        const delay=Number.isFinite(retryAfter)&&retryAfter>0
          ?Math.min(2500,retryAfter*1000)
          :250*Math.pow(2,attempt);
        await pause(delay);
      }catch(error){
        if(attempt===attempts-1||!["TypeError","AbortError","TimeoutError"].includes(error&&error.name))throw error;
        await pause(250*Math.pow(2,attempt));
      }
    }
    throw new Error("API retry loop ended unexpectedly");
  };
});
