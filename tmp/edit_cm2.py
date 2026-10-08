p='views/apps/condition-monitoring.pug'
s=open(p,encoding='utf8').read()
a=s.index("            #cm-asset-info.surface-level-2")
b=s.index("            .cm-story-label Current machine state")
blk=s[a:b]; s=s[:a]+s[b:]
anchor="            #cm-controls.surface-level-2"
s=s.replace(anchor, blk+anchor,1)
open(p,'w',encoding='utf8').write(s)
open('public/stylesheets/apps/condition-monitoring.css','a',encoding='utf8').write("#cm-baseline { padding: 16px; border-radius: 8px; }\n")
