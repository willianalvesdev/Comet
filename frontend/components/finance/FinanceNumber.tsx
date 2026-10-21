import { useEffect, useState } from 'react';
import NumberFlow, { usePrefersReducedMotion, type Format } from '@number-flow/react';

// Timing observed in the reference's FinanceNumberFlow bundle (REA E2).
const transformTiming = { duration: 900, easing: 'linear(0,.005,.019,.039,.066,.096,.129,.165,.202,.24,.278,.316,.354,.39,.426,.461,.494,.526,.557,.586,.614,.64,.665,.689,.711,.731,.751,.769,.786,.802,.817,.831,.844,.856,.867,.877,.887,.896,.904,.912,.919,.925,.931,.937,.942,.947,.951,.955,.959,.962,.965,.968,.971,.973,.976,.978,.98,.981,.983,.984,.986,.987,.988,.989,.99,.991,.992,.992,.993,.994,.994,.995,.995,.996,.996,.9963,.9967,.9969,.9972,.9975,.9977,.9979,.9981,.9982,.9984,.9985,.9987,.9988,.9989,1)' };
export function FinanceNumber({value, percentage=false, signed=false,currency='BRL'}: {value:number;percentage?:boolean;signed?:boolean;currency?:'BRL'|'USD'}) {
 const [animated,setAnimated]=useState(false),reducedMotion=usePrefersReducedMotion();
 useEffect(()=>setAnimated(true),[]);
 const format: Format = percentage ? {maximumFractionDigits:2} : {style:'currency',currency,maximumFractionDigits:currency==='USD'&&value!==0&&Math.abs(value)<1?6:2,signDisplay:signed?'exceptZero':'auto'};
 return <NumberFlow role="img" aria-label={new Intl.NumberFormat('pt-BR',format).format(value)+(percentage?'%':'')} value={value} locales="pt-BR" format={format} suffix={percentage?'%':undefined} isolate animated={animated&&!reducedMotion} transformTiming={transformTiming} opacityTiming={{duration:450,easing:'ease-out'}} />;
}
