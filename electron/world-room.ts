// A code-drawn isometric room: crisp on phones, no textures or remote assets.
const point = (x: number, y: number, z = 0) => [570 + (x - y) * 40, 300 + (x + y) * 20 - z * 40];
const points = (p: number[][]) => p.map(v => point(v[0], v[1], v[2] ?? 0).join(',')).join(' ');
const face = (p: number[][], fill: string, extra = '') => `<polygon points="${points(p)}" fill="${fill}" ${extra}/>`;
function box(x: number, y: number, w: number, d: number, z: number, h: number, top: string, front = '#20253c', side = '#151a2d') {
  return face([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]],front)
    + face([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]],side)
    + face([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],top);
}
const back = (x: number, y: number, z: number, content: string) => `<g transform="translate(${point(x,y,z).join(' ')}) matrix(1 .5 0 1 0 0)">${content}</g>`;
const left = (x: number, y: number, z: number, content: string) => `<g transform="translate(${point(x,y,z).join(' ')}) matrix(1 -.5 0 1 0 0)">${content}</g>`;
const floor = (x: number, y: number, z: number, content: string) => `<g transform="translate(${point(x,y,z).join(' ')}) matrix(1 .5 -1 .5 0 0)">${content}</g>`;
const line = (a: number[], b: number[], color: string, width = 2, extra = '') => `<path d="M${point(a[0],a[1],a[2]??0).join(' ')}L${point(b[0],b[1],b[2]??0).join(' ')}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const books = Array.from({length: 11},(_,i)=>`<rect x="${5+i*8}" y="${i%3*2}" width="6" height="${31-i%3*2}" rx="1" fill="${['#ce70ad','#74b4c6','#8981d2','#d1b17a','#a6cbbf'][i%5]}"/><path d="M${7+i*8} 6v17" stroke="#101327" opacity=".5"/>`).join('');
const figure = (x: number, color: string) => `<g transform="translate(${x} 0)"><ellipse cy="40" rx="11" ry="3" fill="#14182c"/><path d="M-4 27v10m8-10v10" stroke="#9cabc7" stroke-width="3"/><path d="M-7 11l-3 17h20L7 11" fill="${color}"/><circle cy="3" r="7" fill="#eccdc7"/><path d="M-8 4q-2-16 8-15q11 0 8 16l-5-6l-7-3z" fill="#8c90c7"/><path d="M-10 19l-4 10M9 19l5 9" stroke="${color}" stroke-width="3"/></g>`;
const towerWindows = Array.from({length:8},(_,i)=>Array.from({length:10},(_,j)=>`<rect x="${8+i*18}" y="${12+j*13}" width="${i%2?3:7}" height="${j%3?4:7}" fill="${(i+j)%4===0?'#fa85cd':'#63cbd9'}" opacity="${.12+(i*13+j*7)%7/12}"/>`).join('')).join('');
const hotspot = (id: string, label: string, n: string, x: number, y: number) => `<g class="room-hotspot" data-spot="${id}" role="button" tabindex="0" aria-label="Explore ${label}" aria-pressed="false" transform="translate(${x} ${y})"><circle class="hit-area" r="24" fill="transparent"/><circle class="hotspot-ring" r="15"/><circle r="3" fill="currentColor"/><g class="hotspot-caption"><rect x="22" y="-13" height="26" width="${label.length*6+36}" rx="13"/><text x="34" y="4">${n} / ${label}</text></g></g>`;

export const ROOM_SCENE = `<svg id="room" viewBox="110 0 1000 820" xmlns="http://www.w3.org/2000/svg" aria-labelledby="room-title room-desc" role="group">
<title id="room-title">Haru’s cyberpunk bedroom</title><desc id="room-desc">An isometric apartment with a dual-monitor gaming desk, RGB computer, gaming chair, bed with a cat plush, anime posters, manga and figures, tea and a rainy neon city window. Select a furniture marker to explore.</desc>
<defs>
  <linearGradient id="left-wall" x2="1" y2="1"><stop stop-color="#222941"/><stop offset="1" stop-color="#31304b"/></linearGradient>
  <linearGradient id="back-wall" x2="0" y2="1"><stop stop-color="#252739"/><stop offset="1" stop-color="#161d31"/></linearGradient>
  <linearGradient id="floor-light" x2="1" y2="1"><stop stop-color="#323247"/><stop offset="1" stop-color="#171d2e"/></linearGradient>
  <linearGradient id="screen" x2="1" y2="1"><stop stop-color="#252457"/><stop offset=".6" stop-color="#325471"/><stop offset="1" stop-color="#111c34"/></linearGradient>
  <linearGradient id="city-sky" x2="0" y2="1"><stop stop-color="#0b1430"/><stop offset="1" stop-color="#823e85"/></linearGradient>
  <linearGradient id="duvet" x2="1" y2="1"><stop stop-color="#9782bd"/><stop offset="1" stop-color="#535778"/></linearGradient>
  <radialGradient id="pool"><stop stop-color="var(--glow)" stop-opacity=".2"/><stop offset="1" stop-color="var(--glow)" stop-opacity="0"/></radialGradient>
  <filter id="neon-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="room-shadow" x="-20%" y="-30%" width="150%" height="170%"><feGaussianBlur stdDeviation="18"/></filter>
  <clipPath id="window-clip"><rect width="165" height="152" rx="3"/></clipPath>
</defs>
<ellipse cx="608" cy="694" rx="362" ry="78" fill="#03050d" opacity=".7" filter="url(#room-shadow)"/>
${box(0,0,12,10,-.3,.3,'url(#floor-light)','#0f1322','#14182a')}
${face([[0,0,0],[0,10,0],[0,10,6],[0,0,6]],'url(#left-wall)')}
${face([[0,0,0],[12,0,0],[12,0,6],[0,0,6]],'url(#back-wall)')}
${Array.from({length:10},(_,i)=>line([0,i,0.01],[12,i,0.01],'#7880a0',.6,'opacity=".1"')).join('')}
${Array.from({length:7},(_,i)=>line([i*2,0,0.01],[i*2,10,0.01],'#8890ab',.5,'opacity=".12"')).join('')}
${line([0,10,6],[0,0,6],'#626277',5)}${line([0,0,6],[12,0,6],'#424b64',5)}
${line([0,.1,.12],[0,9.9,.12],'var(--glow)',3,'class="light-strip"')}${line([.1,0,.12],[11.9,0,.12],'var(--glow2)',3,'class="light-strip"')}
${line([0,10,0],[12,10,0],'#736186',3)}${line([12,10,0],[12,0,0],'#365766',3)}
<!-- Rainy city window. The skyline remains scenery, not a second playable area. -->
${left(.025,5.05,5.15,`<rect x="-9" y="-9" width="183" height="170" rx="5" fill="#111626" stroke="#63768b" stroke-width="2"/><g clip-path="url(#window-clip)"><rect width="165" height="152" fill="url(#city-sky)"/><circle cx="126" cy="30" r="16" fill="#cea9d7" opacity=".3"/><path d="M0 92V50h18V28h14v22h9v58h8V68h19V46h11V18h13v86h12V62h23V83h9V42h17v50h20v66H0z" fill="#132640"/><path d="M-5 129V88h18v-9h18v55h17V99h27v-19h8v68h18v-29h31V86h13v50h29v40H-5z" fill="#17213a"/>${towerWindows}<path d="M75 38v38m-7-25h14M142 100h23" stroke="#e994d7" stroke-width="3" opacity=".8"/><path d="M0 137h165" stroke="#4caab3" opacity=".4"/><g class="rain" stroke="#b7d9f2" stroke-width=".8" opacity=".4">${Array.from({length:22},(_,i)=>`<path d="M${i*8} ${i*31%140}l-4 21"/>`).join('')}</g><path d="M-8 5L98 155M40-10l99 161" stroke="#d3d2ea" stroke-width="13" opacity=".035"/></g><path d="M82 0v152M0 113h165" stroke="#192333" stroke-width="5"/><path d="M0 153h165" stroke="#98b2c6" stroke-width="2"/><text x="7" y="144" font-size="5" fill="#aad9e5" letter-spacing="2">SECTOR 07 // AFTER DARK</text>`)}
${box(.04,1.0,.38,4.4,1.05,.12,'#495670','#242e45','#222840')}
<!-- Original anime prints above the bed. -->
${left(.03,9.2,4.75,`<rect x="-4" y="-4" width="75" height="112" rx="2" fill="#0e1422" stroke="#796684"/><rect width="67" height="104" fill="#5b4671"/><circle cx="39" cy="34" r="25" fill="#ce6fb3" opacity=".45"/><path d="M13 82q4-31 25-29q24 3 27 40" fill="#191e3a"/><path d="M21 50q-6-40 15-39q28-1 23 43l-10 13H26z" fill="#99aaca"/><ellipse cx="39" cy="37" rx="15" ry="18" fill="#ead0d0"/><path d="M22 33q2-34 27-16l9 20l-19-14l-9 15z" fill="#b3c3db"/><path d="M29 40h7m8-1h7" stroke="#595473" stroke-width="2"/><path d="M7 73l51-38" stroke="#87e4e7" stroke-width="2" opacity=".7"/><text x="7" y="91" fill="#f4d9ec" font-size="8" font-weight="700" letter-spacing="1">NEON GHOST</text><text x="7" y="99" fill="#e5bbd9" font-size="4" letter-spacing="2">夜の向こうへ</text>`)}
${left(.03,7.13,4.65,`<rect x="-4" y="-4" width="59" height="96" rx="2" fill="#0e1422" stroke="#68758a"/><rect width="51" height="88" fill="#233c57"/><circle cx="24" cy="28" r="19" fill="#da8697"/><path d="M-4 77l15-34l14 14l14-24l21 44" fill="#141e38"/><path d="M9 63l31-13m-21-34v31m18-35v29" stroke="#75cfd3" opacity=".6"/><text x="5" y="77" fill="#a8e4e3" font-size="7" letter-spacing="1">AFTERLIGHT</text><text x="7" y="85" fill="#b1c5dc" font-size="4" letter-spacing="1.5">STAY UP / LOOK UP</text>`)}
<!-- Back wall acoustic panels, neon motif and shelf sign. -->
${back(1,.03,5.0,`<rect width="194" height="35" rx="3" fill="#151c2e" stroke="#353e56"/>${Array.from({length:24},(_,i)=>`<path d="M${5+i*8} 3v29" stroke="#45506b" opacity=".6"/>`).join('')}`)}
${back(6.35,.03,5.15,`<path d="M0 38L23 0l24 38M11 23h24M60 0v39h28" fill="none" stroke="var(--glow)" stroke-width="4" filter="url(#neon-glow)"/><path d="M0 38L23 0l24 38M11 23h24M60 0v39h28" fill="none" stroke="#f5b2e6" stroke-width="2"/><text y="62" fill="#9897b0" font-size="7" letter-spacing="3">HARU / OFF DUTY</text>`)}
${back(9.15,.03,4.9,`<path d="M3 18h43M24 0v35" stroke="#738397" stroke-width="1"/><text x="6" y="54" fill="#92b9c9" font-size="9" letter-spacing="3">08:06</text>`)}
<!-- Soft light and graphic rug. -->
${floor(5.05,4.4,.02,'<rect width="177" height="135" rx="10" fill="#25243e" stroke="#635375" stroke-width="2"/><path d="M12 18h150v101H12z" fill="none" stroke="#424460"/><path d="M48 36l61 29l-61 31zM88 36l40 29l-40 31" fill="none" stroke="#78648a" stroke-width="2" opacity=".6"/>')}
<ellipse cx="609" cy="520" rx="205" ry="91" fill="url(#pool)"/>
<!-- Desk: open legs, beveled desktop, two monitors, keyboard, mouse, tablet. -->
${box(1.05,.65,.16,1.9,0,1.85,'#536277','#273043')}${box(6.15,.65,.16,1.9,0,1.85,'#536277','#273043')}
${box(.8,.45,5.8,2.25,1.85,.17,'#41435e','#242b43','#20273b')}
${line([.82,2.72,1.93],[6.6,2.72,1.93],'var(--glow2)',2,'class="light-strip"')}
${[1.0,3.25].map((x,i)=>box(x+.8,.8,.13,.25,2.0,.42,'#61758a')+floor(x+.4,1.0,2.04,'<rect width="42" height="17" rx="5" fill="#141b2d"/>')+back(x,.85,3.65,`<rect x="-4" y="-4" width="86" height="59" rx="4" fill="#0e1525" stroke="#556480" stroke-width="1.5"/><rect width="78" height="49" rx="2" fill="url(#screen)"/>${i===0?'<path d="M0 39L25 17l24 5l29-14v41H0" fill="#6a619b" opacity=".65"/><path d="M20 49l21-27l22 27M28 40h26M33 33h17" fill="none" stroke="#d887d7" stroke-width="1"/><circle cx="61" cy="14" r="8" fill="#e697c9"/><text x="6" y="10" fill="#bceff5" font-size="4" letter-spacing="1">NEON CIRCUIT</text>':'<rect x="4" y="4" width="20" height="41" fill="#17283e"/><path d="M29 9h38m-38 6h29m-29 6h38m-38 6h24" stroke="#9ac4d9" stroke-width="2" opacity=".6"/><path d="M29 37h4v5h-4m8-13h4v13h-4m8-5h4v5h-4m8-10h4v10h-4m8-3h4v3h-4" fill="#b086d6"/>'}<circle cx="39" cy="53" r="1" fill="#7adfdd"/>`)).join('')}
${floor(1.45,1.85,2.04,`<rect width="129" height="28" rx="4" fill="#131a2b" stroke="#777d9c" stroke-width=".8"/>${Array.from({length:4},(_,j)=>Array.from({length:15},(_,i)=>`<rect x="${4+i*8}" y="${3+j*6}" width="6" height="4" rx=".6" fill="${['#ad85d0','#77c3d4','#df96c3'][Math.floor(i/5)]}" opacity=".8"/>`).join('')).join('')}<rect x="43" y="22" width="39" height="3" rx="1" fill="#b0abd8"/><rect x="137" y="-1" width="27" height="31" rx="4" fill="#1e263d" stroke="#636b8d"/><rect x="145" y="7" width="10" height="16" rx="5" fill="#7c80a1"/><path d="M150 8v5" stroke="#d8b9eb"/>`)}
${floor(4.9,2.03,2.07,'<rect width="36" height="23" rx="3" fill="#111729" stroke="#6b748d"/><path d="M5 17l8-10l7 6l8-8" fill="none" stroke="#ac91d5"/><path d="M39 0l-5 25" stroke="#b9b1d0" stroke-width="2"/>')}
<!-- Glass-sided RGB tower. -->
${box(5.65,.65,.8,1.15,2.02,1.68,'#404c65','#172338','#111b2b')}
${back(5.68,1.82,3.6,`<rect width="29" height="57" rx="2" fill="#101b2e" stroke="#53647c"/><g class="pc-fans" fill="none" stroke="var(--glow2)" stroke-width="2"><circle cx="14" cy="13" r="8"/><circle cx="14" cy="35" r="8"/></g><circle cx="14" cy="13" r="3" fill="#ae8add"/><circle cx="14" cy="35" r="3" fill="#ad87d3"/><path d="M6 50h17" stroke="var(--glow)" stroke-width="2"/>`)}
<!-- Manga shelf and collectible figures. -->
${box(8.35,.5,2.8,1.0,0,3.1,'#4b5268','#141d30','#192339')}
${back(8.43,1.52,3.0,`<rect width="105" height="114" fill="#121a2c"/>${[39,77,115].map(y=>`<path d="M0 ${y}h105" stroke="#53627b" stroke-width="5"/>`).join('')}<g transform="translate(1 5)">${books}</g><g transform="translate(1 47)">${books}</g><rect x="7" y="90" width="36" height="18" rx="2" fill="#38455f"/><path d="M15 97h19" stroke="#8d9aaf"/><g transform="translate(75 84)"><path d="M-10 22v-12l5-8l6 6l7-5l4 9v10z" fill="#d7c4cc"/><path d="M-5 15h2m6 0h2" stroke="#57607c" stroke-width="2"/></g>`)}
${back(8.75,1.0,4.08,`${figure(14,'#c785bd')}${figure(58,'#70b9c3')}`)}
<!-- Gaming chair, turned slightly toward the room. -->
<g transform="translate(${point(3.4,3.3,.05).join(' ')})"><ellipse cy="10" rx="32" ry="12" fill="#070d1a" opacity=".5"/><path d="M0-14v22m0-2l-25 7m25-7l25 7m-25-7l-12-11m12 11l15-6" stroke="#4d5b76" stroke-width="5" stroke-linecap="round"/><path d="M-20-30l25-9l26 15l-25 14z" fill="#323c59" stroke="#606884"/><path d="M-23-30l-4-46l12-12l20 9l9 58z" fill="#222b44" stroke="#697493" stroke-width="2"/><path d="M-20-68l3-9l17 7l6 41l-16-7z" fill="#66527c"/><path d="M-18-72l18 9m-14 25l17 9" stroke="#b77fb5" stroke-width="3"/><path d="M-28-31l-4-18l-11-4m68 38l2-18l-9-5" fill="none" stroke="#4b5773" stroke-width="5" stroke-linecap="round"/></g>
<!-- Low bed, pillows, rumpled duvet and a cat plush. -->
${box(.65,6.25,4.4,2.9,.02,.5,'#403c55','#25293e','#282c43')}
${line([.75,9.18,.2],[5.05,9.18,.2],'var(--glow)',2,'class="light-strip"')}
${box(.7,6.3,4.3,2.8,.52,.38,'#b5a8c5','#8f86a6','#827c9c')}
${box(.55,6.2,.18,3.05,.1,1.72,'#716983','#49405d','#514866')}
${box(.88,6.55,.83,1.01,.93,.16,'#d9ccdc','#a99cb8','#b9adc6')}${box(.88,7.85,.83,1.0,.93,.16,'#c1bacf','#9c95b0','#aca3be')}
${box(1.83,6.29,3.18,2.82,.91,.12,'url(#duvet)','#6f658e','#676286')}
${floor(2.05,6.46,1.05,'<path d="M0 16q48 8 111 0M0 24q64 13 111 0M22 0q-8 54 13 103M32 0q-9 51 14 105" stroke="#bfafd2" stroke-width="1.5" opacity=".25" fill="none"/>')}
<g transform="translate(${point(1.6,8.8,1.2).join(' ')})"><ellipse cy="0" rx="13" ry="15" fill="#c8bbd0"/><path d="M-11-6l-2-18l11 8m3 0l13-8l-3 18" fill="#c8bbd0"/><path d="M-7-6h3m9 0h3M-1-1l3 2l3-2" stroke="#5c516e" stroke-width="1.8" stroke-linecap="round" fill="none"/><ellipse cy="9" rx="6" ry="5" fill="#e6d5de"/></g>
<g id="sleep-symbol" opacity="0" fill="#e6d7f6" font-family="monospace"><text x="306" y="477" font-size="16">z</text><text x="323" y="458" font-size="22">z</text><text x="348" y="435" font-size="29">z</text></g>
<!-- Tea table, small speaker and warm lamp. -->
${box(5.75,7.5,1.1,1.3,0,1.25,'#5e5267','#342d44','#3a354c')}
<g transform="translate(${point(6.0,7.9,1.33).join(' ')})"><ellipse cy="3" rx="10" ry="5" fill="#aba0b6"/><path d="M-7-10v12q7 7 14 0v-12" fill="#ddc3d1"/><ellipse cy="-10" rx="7" ry="3" fill="#7d6074"/><path d="M7-7q9-1 6 7l-5 1" fill="none" stroke="#dcc4d3" stroke-width="2"/><path class="steam" d="M-2-17q-5-5 0-10M4-17q5-6 1-11" fill="none" stroke="#e4dbe5" opacity=".35" stroke-width="1.5"/></g>
${box(6.25,7.55,.32,.5,1.25,.6,'#647086','#29354d','#243046')}
${back(6.27,8.08,1.8,'<circle cx="5" cy="8" r="4" fill="#162239" stroke="#7892ab"/><circle cx="5" cy="16" r="3" fill="#162239" stroke="#7892ab"/>')}
<!-- A little greenery and trailing cables make it lived in. -->
${box(10.2,2.15,.7,.7,0,.7,'#a0aab0','#788192','#596b80')}
<g transform="translate(${point(10.55,2.5,.7).join(' ')})"><path d="M0 0v-42m0 23l-16-15m16 21l14-20" stroke="#668c92" stroke-width="3"/><path d="M0-35q-26-25-16-2q8 12 16 15M2-31q24-22 15-1q-5 12-16 10M0-46q-17-18-9 3q6 9 9 13" fill="#79a0a2"/></g>
${floor(6.7,2.0,.04,'<path d="M0 0q42 20 7 43t39 28" stroke="#090f20" stroke-width="3" fill="none"/>')}
<!-- Haru's position is supplied by the simulation, never a decorative timer. -->
<g id="haru-marker" transform="translate(578 464)" aria-label="Haru"><ellipse cy="3" rx="19" ry="8" fill="#070b16" opacity=".55"/><g id="haru-body"><path d="M-7-3v12m14-12v12" stroke="#292b46" stroke-width="6" stroke-linecap="round"/><path d="M-12-8q0-29 24 0l4 10h-32z" fill="#bbb1d4"/><path d="M-13-13l-8 12m33-12l7 12" stroke="#aaa2c9" stroke-width="5" stroke-linecap="round"/><path d="M-16-29q-1-29 16-28q22 0 17 32l-6 10h-23" fill="#9b88b7"/><ellipse cy="-33" rx="12" ry="14" fill="#efd5d2"/><path d="M-14-36q1-24 27-8l2 8q-17-6-19-14q-2 12-10 14" fill="#aea0cb"/><path d="M-8-32h3m10 0h3" stroke="#505076" stroke-width="2.5" stroke-linecap="round"/><path d="M-3-25q3 3 6 0" stroke="#a5708b" stroke-width="1.5" fill="none"/><path d="M8-50l11-1l-2 8l-10-2z" fill="#68d7db"/><path d="M-6-6h12" stroke="#78638e" stroke-width="1"/></g></g>
${hotspot('desk','Gaming setup','01',775,408)}${hotspot('bed','Sleep corner','02',359,591)}${hotspot('shelf','Manga & figures','03',922,455)}${hotspot('window','City window','04',437,272)}${hotspot('tea','Tea & music','05',535,603)}
</svg>`;
