// Résumé-keyword extraction from a job description. Matches a curated tech-skills
// dictionary against the JD text so you can tailor your résumé to exactly what
// each role — and its ATS keyword scanner — is looking for. Pure + unit-tested.

interface Skill {
  label: string;
  pattern: string; // regex source, matched case-insensitively (own word boundaries)
}

const SKILLS: Skill[] = [
  // Languages
  { label: "Python", pattern: "\\bpython\\b" },
  { label: "Java", pattern: "\\bjava\\b(?!script)" },
  { label: "JavaScript", pattern: "\\bjavascript\\b" },
  { label: "TypeScript", pattern: "\\btypescript\\b" },
  { label: "SQL", pattern: "\\bsql\\b" },
  { label: "Go", pattern: "\\bgolang\\b" },
  { label: "C++", pattern: "c\\+\\+" },
  { label: "C#/.NET", pattern: "c#|c-sharp|\\.net\\b" },
  { label: "Scala", pattern: "\\bscala\\b" },
  { label: "Kotlin", pattern: "\\bkotlin\\b" },
  { label: "Rust", pattern: "\\brust\\b" },
  // Cloud
  { label: "AWS", pattern: "\\baws\\b|amazon web services" },
  { label: "Azure", pattern: "\\bazure\\b" },
  { label: "GCP", pattern: "\\bgcp\\b|google cloud" },
  // Data engineering
  { label: "Spark", pattern: "\\bspark\\b" },
  { label: "Hadoop", pattern: "\\bhadoop\\b" },
  { label: "Kafka", pattern: "\\bkafka\\b" },
  { label: "Airflow", pattern: "\\bairflow\\b" },
  { label: "dbt", pattern: "\\bdbt\\b" },
  { label: "Snowflake", pattern: "\\bsnowflake\\b" },
  { label: "Databricks", pattern: "\\bdatabricks\\b" },
  { label: "ETL/ELT", pattern: "\\betl\\b|\\belt\\b" },
  { label: "Data pipelines", pattern: "data pipelines?" },
  { label: "Data warehousing", pattern: "data warehous(e|ing)" },
  { label: "Redshift", pattern: "\\bredshift\\b" },
  { label: "BigQuery", pattern: "\\bbigquery\\b" },
  // Databases
  { label: "PostgreSQL", pattern: "\\b(postgresql|postgres)\\b" },
  { label: "MySQL", pattern: "\\bmysql\\b" },
  { label: "MongoDB", pattern: "\\bmongo(db)?\\b" },
  { label: "Redis", pattern: "\\bredis\\b" },
  // Web / backend
  { label: "React", pattern: "\\breact\\b" },
  { label: "Angular", pattern: "\\bangular\\b" },
  { label: "Node.js", pattern: "\\bnode(\\.js)?\\b" },
  { label: "Django", pattern: "\\bdjango\\b" },
  { label: "Flask", pattern: "\\bflask\\b" },
  { label: "Spring", pattern: "\\bspring( boot)?\\b" },
  { label: "GraphQL", pattern: "\\bgraphql\\b" },
  { label: "REST", pattern: "\\brest(ful)?\\b" },
  { label: "Microservices", pattern: "microservices?" },
  // DevOps
  { label: "Docker", pattern: "\\bdocker\\b" },
  { label: "Kubernetes", pattern: "\\bkubernetes\\b|\\bk8s\\b" },
  { label: "Terraform", pattern: "\\bterraform\\b" },
  { label: "CI/CD", pattern: "ci/cd|continuous integration" },
  { label: "Git", pattern: "\\bgit\\b|github|gitlab" },
  // ML / AI
  { label: "Machine Learning", pattern: "machine learning|\\bml\\b" },
  { label: "Deep Learning", pattern: "deep learning" },
  { label: "TensorFlow", pattern: "\\btensorflow\\b" },
  { label: "PyTorch", pattern: "\\bpytorch\\b" },
  { label: "scikit-learn", pattern: "scikit-learn|sklearn" },
  { label: "NLP", pattern: "\\bnlp\\b|natural language processing" },
  { label: "LLMs/GenAI", pattern: "\\bllm\\b|large language model|generative ai|\\bgenai\\b" },
  { label: "Pandas", pattern: "\\bpandas\\b" },
  // BI
  { label: "Tableau", pattern: "\\btableau\\b" },
  { label: "Power BI", pattern: "power bi" },
  { label: "Looker", pattern: "\\blooker\\b" },
  // Concepts
  { label: "Agile/Scrum", pattern: "\\bagile\\b|\\bscrum\\b" },
  { label: "System Design", pattern: "system design|distributed systems" },
  { label: "Data Structures & Algorithms", pattern: "data structures|algorithms" },
  { label: "Unit Testing", pattern: "unit test|test-driven|\\btdd\\b" },
];

export interface KeywordHit {
  label: string;
  count: number;
}

/** Skills found in the text, ranked by frequency. */
export function extractKeywords(text: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const s of SKILLS) {
    const matches = text.match(new RegExp(s.pattern, "gi"));
    if (matches && matches.length > 0) hits.push({ label: s.label, count: matches.length });
  }
  return hits.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** JD skills absent from the résumé — i.e. the keywords to add to tailor it. */
export function missingFromResume(jdText: string, resumeText: string): string[] {
  const inResume = new Set(extractKeywords(resumeText).map((h) => h.label));
  return extractKeywords(jdText)
    .map((h) => h.label)
    .filter((label) => !inResume.has(label));
}
