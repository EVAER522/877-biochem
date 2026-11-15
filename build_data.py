import json,glob,re,collections

DEFS={
 "超二级结构":"超二级结构是指由若干相邻的二级结构单元彼此相互作用结合在一起，形成有规律、在空间上能够辨认的二级结构组合体，充当三级结构的构建。",
 "结构域":"结构域是指多肽链在二级结构或超二级结构的基础上，进一步盘绕、卷曲形成三级结构的局部折叠区，是相对独立的紧密球状实体。 （对于较大的蛋白质分子，其三级结构往往是由两个或多个在空间上可明显区分的、相对独立的结构域缔合而成的。对于较小的蛋白分子来说，结构域往往就是其三级结构，即较小的蛋白质是单结构域。）",
 "同工酶":"同工酶是指生物体内催化相同化学反应，而蛋白质分子结构、理化性质、免疫性能等方面都存在明显差异的一组酶。",
 "别构酶":"具有别构效应的酶称为别构酶，又称为变构酶。这些酶分子除了具有活性中心外，还含有别构中心。某些小分子物质（效应物或称配体）可与别构中心结合，使酶分子构象发生改变，从而导致酶活性改变。",
 "别构效应":"蛋白质一级结构不变，由于一个亚基与某种小分子结合而引起构象的改变，进而引起其余亚基以致整个分子的构象、性质和功能的改变。",
 "信号肽":"信号肽是引导合成的蛋白质向分泌通路转移的短（长度5-30个氨基酸）肽链。常指新合成多肽链中用于指导蛋白质的跨膜转移（定位）的N-末端的氨基酸序列（有时不一定在N端）。",
 "分子伴侣":"一类在原核生物和真核生物中广泛存在的蛋白质，他们可以通过抑制新生肽链不恰当的聚集，并排除与其他蛋白质不合理的结合，而协助多肽链的正确折叠",
 "PCR":"聚合酶链反应，是一种在体外快速扩增特定基因或DNA序列的方法，故又称为基因的体外扩增法。PCR由变性、退火、延伸三个基本反应步骤构成。",
 "Southern印迹":"Southern提出的，指将电泳分离的DNA片段转移到一定固相支持物上，此称为印迹，然后通过与标记的单链DNA或RNA探针的杂交作用检测这些转移DNA片段，这种实验方法称为Southern印迹。",
 "第二信使":"大多数激素类信号分子不能直接进入细胞，只能通过与膜受体结合后进行信息转换，通常把细胞外的信号称为第一信使，而把细胞内最早产生的信号物质称为第二信使。第二信使则可对细胞内多条代谢途径进行调节。",
 "顺式作用元件":"能与特异性转录因子结合，以决定转录的起始位点、转录效率及转录的空间特异性的DNA序列。",
 "反式作用因子":"反式作用因子是转录模板上游基因编码的一类蛋白调节因子，包括激活因子和阻遏因子等，它们与顺式作用元件中的上游激活序列特异性结合，对真核生物基因的转录分别起促进和抑制作用。",
 "酮体":"在动物的肝、肾、脑组织中，尤其在饥饿、禁食、糖尿病等情形下，乙酰CoA还有另一条去向，最终生成乙酰乙酸、D-β-羟丁酸和丙酮，这3种产物统称为酮体",
 "端粒酶":"端粒酶可外加重复序列到5’端，维持端粒的一定长度。端粒酶是一种含有RNA链的逆转录酶，它是由蛋白质和RNA两部分组成的。其中蛋白质具有逆转录酶的活性，其三维结构与其他逆转录酶有明显的相似性。",
 "化学渗透学说":"英国生物化学家P.Mitchell提出了一个电子传递过程中产生的自由能驱动ATP合成的学说，即化学渗透学说。 P.Mitchell认为，自由能的释放和电子传递及ATP合成之间的偶联是在电子传递链的质子驱动力作用下完成的，之所以把这个过程称为化学渗透，就是因为生成ATP的过程是和渗透压驱动的质子流动过程相偶联的。",
 "乳糖操纵子":"包括依次排列着的启动子、操纵基因和三个结构基因。其中结构基因lacZ编码分解乳糖的β-半乳糖苷酶，lacY编码吸收乳糖的β-半乳糖苷透过酶，lacA编码β-半乳糖苷转乙酰酶。",
 "操纵子":"所谓操纵子即基因表达的协调单位，包括启动子P、操纵基因O和在功能上彼此相关的结构基因S。启动子和操纵基因是操纵子中的控制部位，不编码任何蛋白质。启动子是RNA聚合酶的结合部位，操纵基因是调节基因产物的结合部位，也是调控RNA聚合酶进行转录的部位。",
 "补救途径":"利用体内游离的碱基和核苷，经过比较简单的反应过程合成核苷酸。",
 "一碳单位":"一碳单位：某些氨基酸分解代谢中产生的含一个碳原子的基团，如甲基、亚甲基、甲川基、甲酰基、亚氨甲基，多与四氢叶酸结合转运，参与嘌呤、嘧啶和SAM的合成",
 "磷酸戊糖途径":"磷酸戊糖途径：葡萄糖-6-磷酸经氧化脱羧生成核糖-5-磷酸和NADPH的糖代谢旁路，分氧化阶段和基团转移阶段，为核酸合成提供核糖、为还原性合成和抗氧化提供NADPH",
 "增色效应":"核酸变性后，因双链解开，碱基暴露，所以在260nm的紫外吸收值明显增强。同时黏度下降，浮力密度升高，生物学活性降低、丧失或不变。",
 "苹果酸-天冬氨酸穿梭":"这种穿梭作用主要存在于肝脏和心肌组织中。胞质中的NADH在苹果酸脱氢酶的催化下，将草酰乙酸还原成苹果酸，后者借助线粒体内膜上的苹果酸-α-酮戊二酸载体进入线粒体基质，进入基质内的苹果酸在线粒体内苹果酸脱氢酶的催化下重新生成草酰乙酸和NADH，NADH可以进入电子传递链。草酰乙酸经谷草转氨酶催化生成天冬氨酸，后者再经酸性氨基酸载体转运出线粒体转变成草酰乙酸。所以胞质中的NADH经苹果酸穿梭后的P/O比仍然是2.5。",
 "脂肪酸的β-氧化":"脂肪酸的β-氧化：脂肪酸在细胞质活化生成脂酰CoA后转入线粒体，经脱氢、水化、再脱氢和硫解四步反复进行，每次从羧基端切下二碳单位生成乙酰CoA和缩短两碳的脂酰CoA，同时产生NADH和FADH2",
}
DEFS.update({
 "Tm值":"通常将DNA变性所需的狭窄温度范围的中点，即溶解曲线中点所对应的温度，称为解链温度或溶解温度。",
 "酶的活性中心":"指酶分子上直接与底物结合，并将底物转化为产物的区域。也就是说，酶在其活性中心与所催化的底物相结合。",
 "柠檬酸循环":"三羧酸循环是指乙酰CoA先与草酰乙酸合成柠檬酸，而后经过一系列氧化、脱羧生成CO2并再生草酰乙酸的循环反应过程，因为循环反应产生的第一个产物柠檬酸为三羧酸，故称为三羧酸循环，简称TCA循环，也称为柠檬酸循环。",
 "β-氧化":"脂肪酸在一系列酶的作用下，羧基端的β位C原子发生氧化，碳链在α位C原子与β位C原子间发生断裂，每次生成一个乙酰CoA和较原来少2个碳单位的脂肪酸，这个不断重复进行的脂肪酸氧化过程称为β-氧化。",
 "逆转录酶":"逆转录酶需要以RNA（或DNA）为模板，以4种dNTP为原料，要求短链RNA（或DNA）作为引物，此外还需要适当浓度的二阶阳离子Mg2+和Mn2+，沿5’→3’方向合成DNA，形成RNA-DNA杂合分子（或DNA双链分子）。以后，再以RNA-DNA杂合分子中的DNA为模板，合成另一条DNA互补链，这样便形成新的双链DNA分子（前病毒）。 逆转录酶是一种多功能酶，它具有多种酶活性： 以RNA为模板的DNA聚合酶活性，形成RNA-DNA杂合分子； 具有RNaseH的活性，专门水解RNA-DNA杂合分子中的RNA； 以新合成的DNA链为模板的DNA聚合酶活性，形成双链DNA分子。 （此外，还具有DNA内切酶、DNA拓扑异构酶、DNA解旋酶和tRNA结合酶的活性。）",
 "启动子":"DNA分子上的起始信号，即启动序列“称为启动子。or启动子是指RNA聚合酶识别、结合和开始转录的一段DNA序列。",
 "退火":"模板DNA经加热变形成单链后，温度降至55°C左右，引物与模板DNA单链的互补序列配对结合。",
 "乳酸循环":"肌肉收缩（尤其是供氧不足时）通过糖酵解生成乳酸。肌肉内糖异生活性较低，所以乳酸通过细胞膜弥散进入血液后，再入肝，在肝内异生为葡萄糖。葡萄糖释入血液后又可被肌肉摄取，这就构成了一个循环（肌肉-肝脏-肌肉），此循环称为乳酸循环，也称Cori循环。",
})
def norm_concept(s):
    s=re.sub(r'\(.*?\)|（.*?）','',s); s=s.replace('77','')
    return re.sub(r'\s+','',s)

qs=json.load(open('qs_final.json'))
import os
if os.path.exists('ans_final.json'):
    A=json.load(open('ans_final.json'))
else:
    A={}
    for f in glob.glob('ans/M*.json'): A.update(json.load(open(f)))
res={r['id']:r for r in json.load(open('cls/res.json'))}
TY={"是非题":"判断","判断题":"判断","填空题":"填空","选择题":"选择","单项选择题":"单选","多项选择题":"多选","名词解释":"名词","问答题":"问答","计算题和叙述题":"问答/计算","计算题和论述题":"问答/计算"}
# 1) 名词解释：用同名术语的最完整答案替换"见XXXX年"
def body(a): return a.split('｜考点')[0].strip()
def kp(a):  return a.split('｜考点')[1].strip() if '｜考点' in a else ''
terms=collections.defaultdict(list)
for q in qs:
    if '名词' in q['type']:
        t=q['clean'].strip()
        if not re.search(r'见\s*20\d\d',A[q['id']]): terms[t].append(A[q['id']])
fixed=0
for q in qs:
    a=A[q['id']]
    if '名词' in q['type'] and re.search(r'∧见|见\s*20\d\d',a):
        cand=[x for x in terms.get(q['clean'].strip(),[])]
        d=DEFS.get(norm_concept(q['clean']))
        best=max(cand,key=lambda x:len(body(x))) if cand else None
        if best and len(body(best))>len(d or ''):
            A[q['id']]=body(best)+('｜考点：'+kp(a) if kp(a) else ''); fixed+=1
        elif d:
            A[q['id']]=d+('｜考点：'+kp(a) if kp(a) else ''); fixed+=1
print('名词解释补全',fixed)
# 2) 选项解析
def esc(s): return s
def split_opts(text):
    m=re.search(r'\s*[AＡ][.．、]',text)
    if not m: return None,None
    head=text[:m.start()].strip()
    tail=text[m.start():]
    parts=re.split(r'\s*[A-DＡ-Ｄ][.．、]\s*',tail)
    opts=[p.strip() for p in parts[1:] if p.strip()]
    if len(opts)<2: return None,None
    opts=[re.sub(r'\s+',' ',o) for o in opts]
    # 去掉选项尾部粘连的下一题/注释
    return head,opts
recs=[]
for q in qs:
    a=A[q['id']]; b=body(a); k=kp(a); stem=q['clean']
    ty=TY.get(q['type'],q['type'])
    opts=None; correct=None
    if '选择' in q['type']:
        h,o=split_opts(stem)
        if o: stem,opts=h,o
        m=re.match(r'^([A-DＡ-Ｄ]+)',b)
        if m: correct=re.sub('[Ａ-Ｄ]',lambda x:chr(ord(x.group())-0xFEE0),m.group(1))
    if ty=='判断':
        correct='√' if b.strip().startswith(('√','对','正确')) else ('×' if b.strip().startswith(('×','错','错误')) else None)
    # 3) 要点拆分（非选择题）
    b2=re.sub(r'[（(]\d+[）)]','',b)
    pts=[]
    if ty in ('名词','问答','问答/计算','填空'):
        raw=[s.strip() for s in re.split(r'[；;。]',b2) if s.strip()]
        while len(raw)>3:
            n=(len(raw)+2)//3; raw=['，'.join(raw[i:i+n]) for i in range(0,len(raw),n)]
        pts=[x for x in raw if x][:3]
    r=res[q['id']]
    recs.append({'id':q['id'],'y':q['year'],'num':q['raw_num'],'ty':ty,'ch':r['ch'],'chn':r['kp'].startswith('综合') and '综合' or None,
                 'kp':r['kp'],'stem':re.sub(r'\s+',' ',stem).strip(),'opts':opts,'correct':correct,
                 'ans':re.sub(r'\s+',' ',b).strip(),'kpnote':k,'pts':pts,'chap':r['ch']})
import sys; sys.path.insert(0,'cls'); from rules import CH
for r in recs: r.pop('chn'); r['chname']=CH[r['chap']]
out='window.QBANK='+json.dumps(recs,ensure_ascii=False,separators=(',',':'))+';\n'
out+='window.CHAPTERS='+json.dumps([{'id':c,'name':CH[c],'n':sum(1 for r in recs if r["chap"]==c)} for c in CH if any(r['chap']==c for r in recs)],ensure_ascii=False)+';\n'
kpcount=collections.Counter((r['chap'],r['kp']) for r in recs)
out+='window.KPS='+json.dumps([{'ch':c,'kp':k,'n':n} for (c,k),n in kpcount.items()],ensure_ascii=False)+';\n'
open('app/questions.js','w').write(out)
print('总数',len(recs),'有选项',sum(1 for r in recs if r['opts']),'有正确项',sum(1 for r in recs if r['correct']),'要点题',sum(1 for r in recs if r['pts']))
print('文件KB',len(out.encode())//1024)
print(json.dumps(recs[0],ensure_ascii=False)[:400])
print(json.dumps([r for r in recs if r['ty']=='名词' and '信号肽' in r['stem']][0],ensure_ascii=False)[:400])
