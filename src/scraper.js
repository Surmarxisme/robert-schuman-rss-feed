const puppeteer = require('puppeteer');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  url: 'https://www.robert-schuman.eu/publications/questions-et-entretiens-d-europe-1',
  baseUrl: 'https://www.robert-schuman.eu',
  articleSelector: 'a[href*="/fr/questions-d-europe/"]',
  maxArticles: 20,
  navigationTimeout: 30000,  // 30s max pour charger la page
  selectorTimeout: 10000     // 10s max pour trouver les articles
};

// Fonction pour parser une date depuis le texte du titre
function parseDateFromTitle(title) {
  // Cherche un pattern comme "- 2/2/2026" ou "- 11/24/2025" à la fin du titre
  const dateMatch = title.match(/\s+-\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);

  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    // Crée une date en format ISO (YYYY-MM-DD)
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);

    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

async function scrapeArticles() {
  console.log('\ud83d\ude80 Lancement du scraping...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();

    // Timeout global sur la page : coupe toute opération bloquante après 60s
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(CONFIG.navigationTimeout);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`\ud83d\udce1 Navigation vers ${CONFIG.url}...`);

    // Utilise 'domcontentloaded' au lieu de 'networkidle0'
    // 'networkidle0' attend que TOUT le réseau soit silencieux (peut bloquer indéfiniment)
    await page.goto(CONFIG.url, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.navigationTimeout
    });

    console.log('\u23f3 Attente du sélecteur d\'articles...');

    try {
      await page.waitForSelector(CONFIG.articleSelector, {
        timeout: CONFIG.selectorTimeout
      });
    } catch (error) {
      console.warn('\u26a0\ufe0f Sélecteur non trouvé dans les délais, tentative d\'extraction quand même...');
    }

    console.log('\ud83d\udd0d Extraction des articles...');

    const articles = await page.evaluate((selector, baseUrl, maxArticles) => {
      const links = Array.from(document.querySelectorAll(selector));
      const uniqueArticles = new Map();

      links.forEach(link => {
        const href = link.href;

        if (!uniqueArticles.has(href)) {
          const container = link.closest('article, div, li') || link;
          let title = link.textContent.trim();

          if (!title) {
            const heading = container.querySelector('h1, h2, h3, h4, h5, h6');
            title = heading ? heading.textContent.trim() : 'Article sans titre';
          }

          const descElement = container.querySelector('p, .description, .summary, [class*="excerpt"]');
          const description = descElement ? descElement.textContent.trim() : '';

          uniqueArticles.set(href, {
            title: title,
            url: href.startsWith('http') ? href : baseUrl + href,
            description: description
          });
        }
      });

      return Array.from(uniqueArticles.values()).slice(0, maxArticles);
    }, CONFIG.articleSelector, CONFIG.baseUrl, CONFIG.maxArticles);

    // Parser les dates depuis les titres
    articles.forEach(article => {
      const dateFromTitle = parseDateFromTitle(article.title);
      article.pubDate = dateFromTitle ? dateFromTitle.toISOString() : new Date().toISOString();
    });

    console.log(`\u2705 ${articles.length} articles trouvés`);

    if (articles.length === 0) {
      console.warn('\u26a0\ufe0f Aucun article trouvé.');
    }

    await browser.close();
    return articles;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function generateRSSFeed(articles) {
  console.log('\ud83d\udcdd Génération du flux RSS...');

  const feed = new RSS({
    title: 'Fondation Robert Schuman - Questions d\'Europe',
    description: 'Les dernières publications de la Fondation Robert Schuman',
    feed_url: 'https://surmarxisme.github.io/robert-schuman-rss-feed/feed.xml',
    site_url: CONFIG.baseUrl,
    language: 'fr',
    generator: 'GitHub Actions RSS Generator'
  });

  articles.forEach(article => {
    feed.item({
      title: article.title,
      description: article.description || article.title,
      url: article.url,
      guid: article.url,
      date: article.pubDate
    });
  });

  return feed.xml({ indent: true });
}

async function saveFeedToFile(xmlContent) {
  const feedPath = path.join(__dirname, '..', 'feed.xml');
  fs.writeFileSync(feedPath, xmlContent, 'utf8');
  console.log(`\u2705 Flux RSS sauvegardé : ${feedPath}`);

  const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flux RSS - Fondation Robert Schuman</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #003399; }
    .info { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .feed-url { background: white; padding: 10px; border: 1px solid #ddd; word-break: break-all; }
    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>\ud83d\udce1 Flux RSS - Fondation Robert Schuman</h1>
  <div class="info">
    <h2>URL du flux RSS :</h2>
    <div class="feed-url">https://surmarxisme.github.io/robert-schuman-rss-feed/feed.xml</div>
  </div>
  <h2>Comment l'utiliser :</h2>
  <ul>
    <li>Copiez l'URL ci-dessus</li>
    <li>Ajoutez-la dans votre lecteur RSS préféré (Feedly, Inoreader, NetNewsWire, etc.)</li>
    <li>Le flux se met à jour automatiquement toutes les 6 heures</li>
  </ul>
  <a href="feed.xml">Voir le fichier XML brut</a>
</body>
</html>`;

  const htmlPath = path.join(__dirname, '..', 'index.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log(`\u2705 Page HTML sauvegardée : ${htmlPath}`);
}

async function main() {
  try {
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log('\ud83e\udd16 RSS Generator - Fondation Robert Schuman');
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

    const articles = await scrapeArticles();

    if (articles.length === 0) {
      throw new Error('Aucun article trouvé.');
    }

    const xmlContent = await generateRSSFeed(articles);
    await saveFeedToFile(xmlContent);

    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log('\u2728 Génération terminée avec succès !');
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  } catch (error) {
    console.error('\n\u274c ERREUR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
