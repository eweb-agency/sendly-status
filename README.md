# État des services Sendly

La page publique qui répond à une seule question, posée dans un seul moment :
**« est-ce que ça vient de vous ? »**

👉 `https://status.eweb-agency.fr` *(une fois le domaine branché — voir plus bas)*

---

## La règle qui commande toute l'architecture

**Rien de ce dispositif ne tourne sur le serveur qu'il surveille.**

Une page de statut hébergée sur la machine surveillée disparaît au moment
précis où on la consulte. Et une sonde exécutée sur cette même machine ne
mesure pas ce que vit le client : elle dit « joignable depuis moi-même »,
jamais « joignable depuis internet ».

D'où la séparation :

| Rôle | Qui l'assure | Pourquoi |
|---|---|---|
| Sonder les services | **GitHub Actions** | Sonde depuis l'extérieur, indépendante du VPS |
| Servir la page | **Vercel** | Reste debout si le VPS tombe |
| Héberger le produit | VPS Sendly | C'est ce qui est surveillé |

Si les trois tombaient en même temps, ce serait une panne d'internet, pas une
panne Sendly.

---

## Ce qui est surveillé

Quatre services, décrits **du point de vue du client** — pas de
l'infrastructure. Un client se moque de savoir quel conteneur est tombé.

| Service | Ce qu'il couvre |
|---|---|
| Portail Sendly | Connexion, tableau de bord, réglages |
| Espace marketing | Contacts, segments, campagnes, e-mails |
| Script de suivi | Le script installé sur le site du client |
| Service d'envoi | L'acheminement des e-mails (Mailgun) |

**Le provisionneur n'y figure pas** : il vit derrière le réseau privé, donc
injoignable depuis l'extérieur. L'inclure afficherait un service
perpétuellement en panne — et un tableau qui crie au loup n'est plus lu.

Pour ajouter ou retirer un service : `data/monitors.json`. Le champ `expect`
liste les codes considérés comme sains ; le service d'envoi accepte `401`,
car un service qui demande à s'authentifier est un service **vivant**.

---

## Deux règles d'honnêteté, à ne pas « simplifier »

**Jamais de vert par défaut.** Si la page n'arrive pas à charger ses données,
elle écrit qu'elle ne sait pas — et précise que cela ne signifie pas une panne.
Afficher « tout va bien » sans avoir mesuré, c'est mentir à quelqu'un qui subit
justement une panne.

**La disponibilité annonce son étendue réelle.** Au bout d'une journée, la page
écrit « 100 % sur 1 jour mesuré », pas « 100 % sur 90 jours ». Le second est
vrai au sens strict et trompeur au sens utile.

---

## Mise en service

### 1. Déployer sur Vercel

1. [vercel.com/new](https://vercel.com/new) → importer ce dépôt
2. Framework : **Other** — c'est un site statique, aucune configuration
3. Déployer

### 2. Brancher le domaine

1. Dans le projet Vercel : **Settings → Domains** → ajouter
   `status.eweb-agency.fr`
2. Chez le registrar du domaine, créer l'enregistrement **CNAME** que Vercel
   affiche (typiquement `status` → `cname.vercel-dns.com`)

### 3. Afficher le lien dans Sendly

Renseigner la variable dans l'environnement du portail :

```
NEXT_PUBLIC_STATUS_PAGE_URL=https://status.eweb-agency.fr
```

Le lien apparaît alors dans le pied de page du site et dans le menu du portail.
Tant qu'elle est vide, aucun lien n'est affiché — pas de lien mort.

---

## Exploitation

**La sonde tourne toutes les 5 minutes** (`.github/workflows/probe.yml`) et
publie ses mesures dans `data/`. Chaque publication déclenche un redéploiement
Vercel : la page est donc à jour sans intervention.

**Déclencher une mesure à la main** : onglet Actions → *Sonde de disponibilité*
→ *Run workflow*.

**Tester en local** :

```bash
node scripts/probe.mjs && python3 -m http.server 4173
```

**Les incidents sont déduits**, jamais saisis : un passage en panne ouvre un
incident, le retour à la normale le ferme. Une panne qui dure ne crée pas un
incident par sondage.

---

## Coût

Zéro. GitHub Actions et Vercel couvrent cet usage dans leurs offres gratuites,
et aucun service tiers n'appose sa marque sur la page.
