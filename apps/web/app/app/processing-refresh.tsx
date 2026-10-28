"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Observe durable work only while a visible screen has unfinished jobs. */
export function ProcessingRefresh({ active }: { active: boolean }) {
  const router=useRouter();
  useEffect(()=>{
    if(!active)return;
    const refresh=()=>{if(document.visibilityState==="visible")router.refresh();};
    const timer=window.setInterval(refresh,5000);
    window.addEventListener("focus",refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[active,router]);
  return null;
}
