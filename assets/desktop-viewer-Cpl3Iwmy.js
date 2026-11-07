const a=/^(local\/(?:shared(?:-seat-[23])?|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+)$/,e=s=>`local/${s.key.replace(":","-")}${s.seat&&s.seat>1?`-seat-${s.seat}`:""}`;export{a as D,e as v};
