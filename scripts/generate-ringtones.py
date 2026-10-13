"""Generate original incoming-call melodies; no sampled or licensed audio."""
import math, wave, struct
from pathlib import Path
RATE=24000
SOUNDS={
 'chime':[(0,784,.42),(.22,1046.5,.5),(.48,1318.5,.7),(1.35,784,.42),(1.57,1046.5,.5),(1.83,1318.5,.7)],
 'ripple':[(i*.16, f,.48) for i,f in enumerate([659.25,880,987.77,1318.5,987.77,880])],
 'marimba':[(i*.22,f,.4) for i,f in enumerate([523.25,659.25,783.99,659.25,523.25,783.99])],
 'classic':[(i*.12, 1600 if i%2 else 1250,.105) for i in list(range(8))+list(range(12,20))],
}
for name,notes in SOUNDS.items():
 samples=[0.0]*(RATE*4)
 for start,freq,duration in notes:
  for j in range(int(duration*RATE)):
   t=j/RATE
   env=min(1,t/.008)*math.exp(-t*(9 if name=='marimba' else 5))*min(1,(duration-t)/.035)
   tone=math.sin(2*math.pi*freq*t)+.24*math.sin(2*math.pi*freq*2.01*t)+.08*math.sin(2*math.pi*freq*3*t)
   samples[int(start*RATE)+j]+=tone*env
 peak=max(map(abs,samples));pcm=b''.join(struct.pack('<h',round(x/peak*20000)) for x in samples)
 for root in ['apps/web/public/ringtones','apps/desktop/assets/ringtones']:
  with wave.open(str(Path(root)/(name+'.wav')),'wb') as f:
   f.setparams((1,2,RATE,0,'NONE','not compressed'));f.writeframes(pcm)
