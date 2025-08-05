
// src/features/templates/default.ts
export const defaultTemplates = {
  article: `{{#if author}}
> 👤 **저자**: {{author}}\n
{{/if}}
{{#if publishedDate}}
> 📅 **발행일**: {{publishedDate}}\n
{{/if}}
{{#if sourceUrl}}
> 🔗 **원본**: [{{sourceUrl}}]({{sourceUrl}})\n
{{/if}}
{{#if timestamp}}
> 📎 **클리핑**: {{timestamp}}\n
{{/if}}

---

{{#if excerpt}}
**요약**: {{excerpt}}\n
{{/if}}

{{content}}

{{#if highlights}}
## 📌 하이라이트

{{#each highlights}}
> {{this}}
{{/each}}
{{/if}}`,

  simple: `# {{title}}

> 출처: {{sourceUrl}}\n

{{content}}`,

  research: `# {{title}}

## 📋 메타데이터
- **URL**: {{sourceUrl}}
- **저장일**: {{timestamp}}
- **태그**: {{tags}}

## 📝 주요 내용

{{content}}

## 🔍 참고사항

{{#if highlights}}
### 하이라이트된 부분
{{#each highlights}}
- {{this}}
{{/each}}
{{/if}}
`};
