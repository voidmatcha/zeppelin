import{n as e}from"./rolldown-runtime-DkW27tQK.js";import{n as t,t as n}from"./MarkdownAnswer-EK7UlWg9.js";var r,i,a,o,s,c,l;function u(){return(u=e((()=>{t(),{fn:r}=__STORYBOOK_MODULE_TEST__,i={title:`Assistant/MarkdownAnswer`,component:n,args:{onOpenParagraph:r()}},a={args:{content:`## Query results

| Region | Revenue | Change |
| --- | ---: | ---: |
| Europe | 142,500 | **+12%** |
| Asia Pacific | 98,200 | +8% |

- [x] Read notebook context
- [ ] Compare last quarter`}},o={args:{content:`Group the daily orders by region:

\`\`\`sql
SELECT region, SUM(revenue) AS total_revenue
FROM orders
GROUP BY region
ORDER BY total_revenue DESC;
\`\`\``}},s={args:{content:`Here is the query so far:

\`\`\`sql
SELECT region, SUM(revenue)
FROM orders
WHERE`}},c={args:{content:"The query in `paragraph_1_100` aggregates revenue by region.",describeParagraph:()=>({text:`Revenue by region`,name:`Revenue by region`})}},l=[`GfmTable`,`SqlCode`,`PartialFence`,`ParagraphReference`]})))()}u();export{a as GfmTable,c as ParagraphReference,s as PartialFence,o as SqlCode,l as __namedExportsOrder,i as default};