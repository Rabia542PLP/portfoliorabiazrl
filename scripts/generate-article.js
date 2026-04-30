const fs = require('fs');
const path = require('path');

const OLLAMA_API_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

async function generateWithOllama(prompt) {
  const fetch = (await import('node-fetch')).default;
  const response = await fetch(OLLAMA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json();
  return data.response;
}

async function searchCyberNews() {
  const fetch = (await import('node-fetch')).default;
  const queries = [
    'Zero Trust Network Access ZTNA 2025',
    'cybersécurité réseau entreprise actualités',
    'Zscaler Cloudflare Access Zero Trust',
  ];

  const results = [];
  for (const query of queries) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VeilleBot/1.0)' },
      });
      const html = await res.text();

      // Extraire les titres et snippets basiques
      const titleMatches = html.match(/<a class="result__a"[^>]*>([^<]+)<\/a>/g) || [];
      const snippetMatches = html.match(/<a class="result__snippet"[^>]*>([^<]+)<\/a>/g) || [];

      titleMatches.slice(0, 3).forEach((t, i) => {
        const title = t.replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatches[i] ? snippetMatches[i].replace(/<[^>]+>/g, '').trim() : '';
        if (title) results.push({ title, snippet });
      });
    } catch (e) {
      console.warn(`Impossible de récupérer les actualités pour "${query}": ${e.message}`);
    }
  }
  return results;
}

async function generateArticle(newsResults) {
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const newsContext = newsResults.length > 0
    ? `\n\nActualités récupérées cette semaine :\n${newsResults.map(n => `- ${n.title}${n.snippet ? ': ' + n.snippet : ''}`).join('\n')}`
    : '';

  const prompt = `Tu es une experte en cybersécurité spécialisée dans le Zero Trust Network Access (ZTNA), la sécurité des réseaux et des infrastructures informatiques.

Rédige un article de veille technologique hebdomadaire sur la cybersécurité et les évolutions des réseaux sécurisés.${newsContext}

Consignes de rédaction :
- Rédigé en français
- Couvre les nouveautés et tendances de la semaine (du ${lastWeek.toLocaleDateString('fr-FR')} au ${today.toLocaleDateString('fr-FR')})
- Structuré avec des titres et sous-titres en markdown (# ## ###)
- Ton professionnel mais accessible pour un étudiant BTS SIO
- Longueur idéale : 400-600 mots
- Mentionne des technologies concrètes si pertinent : ZTNA, Zero Trust, VPN, Zscaler, Cloudflare Access, Cisco, NIST, pfSense, Active Directory, IAM, etc.
- Peut couvrir : nouvelles vulnérabilités, évolutions réglementaires (RGPD, NIS2), nouvelles solutions réseau, bonnes pratiques

Format de réponse en JSON strict :
{
  "title": "Titre de l'article",
  "summary": "Résumé en 2-3 phrases",
  "content": "Contenu complet en markdown. Utilise \\n pour les sauts de ligne.",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "sources": ["https://example.com/source1"]
}

IMPORTANT : Réponds UNIQUEMENT avec le JSON valide, aucun texte avant ou après.`;

  console.log('🤖 Génération avec Ollama...');
  const response = await generateWithOllama(prompt);
  console.log('📄 Réponse brute (500 premiers caractères):');
  console.log(response.substring(0, 500));

  let articleData;
  try {
    let cleaned = response.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];
    articleData = JSON.parse(cleaned);
  } catch (e) {
    console.error('❌ Erreur parsing JSON:', e.message);
    // Nettoyage agressif
    let cleaned = response.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Impossible d\'extraire un JSON valide');
    articleData = JSON.parse(jsonMatch[0]);
  }

  return {
    id: `article-${today.toISOString().split('T')[0]}-${Date.now()}`,
    title: articleData.title,
    summary: articleData.summary,
    content: articleData.content,
    date: today.toISOString(),
    tags: articleData.tags || ['Zero Trust', 'ZTNA', 'Cybersécurité', 'Veille'],
    sources: articleData.sources || [],
  };
}

async function saveArticle(article) {
  const dataDir = path.join(__dirname, '..', 'data');
  const articlesDir = path.join(dataDir, 'articles');

  if (!fs.existsSync(articlesDir)) fs.mkdirSync(articlesDir, { recursive: true });

  // Sauvegarde individuelle
  const filePath = path.join(articlesDir, `${article.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(article, null, 2), 'utf8');
  console.log(`💾 Fichier individuel : ${filePath}`);

  // Mise à jour articles.json (tableau, plus récent en premier, max 20)
  const articlesJsonPath = path.join(dataDir, 'articles.json');
  let articles = [];
  if (fs.existsSync(articlesJsonPath)) {
    try {
      articles = JSON.parse(fs.readFileSync(articlesJsonPath, 'utf8'));
    } catch {
      articles = [];
    }
  }

  // Éviter les doublons (même date)
  const dateKey = article.date.split('T')[0];
  articles = articles.filter(a => !a.date.startsWith(dateKey));

  articles.unshift(article);
  articles = articles.slice(0, 20); // Garder les 20 derniers

  fs.writeFileSync(articlesJsonPath, JSON.stringify(articles, null, 2), 'utf8');
  console.log(`📝 articles.json mis à jour (${articles.length} article(s))`);
}

async function main() {
  try {
    console.log('🚀 Démarrage de la génération d\'article de veille cybersécurité...\n');

    console.log('📰 Recherche des actualités cybersécurité...');
    const newsResults = await searchCyberNews();
    console.log(`✅ ${newsResults.length} résultat(s) trouvé(s)\n`);

    const article = await generateArticle(newsResults);

    console.log('\n📝 Article généré :');
    console.log('Titre :', article.title);
    console.log('Résumé :', article.summary);
    console.log('Tags :', article.tags.join(', '));
    console.log('Sources :', article.sources.length, 'source(s)');

    await saveArticle(article);
    console.log('\n🎉 Terminé avec succès !');
  } catch (error) {
    console.error('❌ Erreur :', error.message);
    process.exit(1);
  }
}

main();
