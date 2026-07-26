/**
 * Sonde de disponibilité — exécutée par GitHub Actions, DEPUIS L'EXTÉRIEUR.
 *
 * ⚠️ POURQUOI CE SCRIPT NE TOURNE PAS SUR LE SERVEUR SENDLY.
 * Une sonde hébergée sur la machine qu'elle surveille ne mesure pas ce que vit
 * le client : elle dit « joignable depuis moi-même », jamais « joignable
 * depuis internet ». Et le jour où la machine tombe, la sonde tombe avec, donc
 * la page annonce « tout va bien » pendant la panne. C'est pour ça que le
 * sondage part de l'infrastructure GitHub et que la page est servie par
 * Vercel : deux hébergeurs distincts de celui qu'on surveille.
 *
 * ⚠️ CE QUI EST MESURÉ EST UNE DISPONIBILITÉ, PAS UN DROIT D'ACCÈS.
 * Le service d'envoi répond 401 sans clé d'API : c'est un service VIVANT qui
 * demande à s'authentifier. Le compter comme une panne afficherait une panne
 * permanente, et une page qui crie au loup n'est plus lue. D'où `expect` par
 * sonde plutôt qu'un 200 universel.
 *
 * ÉTAT PRODUIT : `data/status.json` (instantané), `data/history.json`
 * (agrégat JOURNALIER — 90 nombres par service, pas des millions de points),
 * `data/incidents.json` (déduit des changements d'état).
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = new URL("../data/", import.meta.url).pathname;
const TIMEOUT_MS = 15_000;
/** Au-delà, l'historique est tronqué : c'est la fenêtre affichée. */
const HISTORY_DAYS = 90;

/** Lecture tolérante : un fichier absent au premier tour n'est pas une erreur. */
async function readJson(name, fallback) {
	try {
		return JSON.parse(await readFile(join(DATA, name), "utf8"));
	} catch {
		return fallback;
	}
}

async function writeJson(name, value) {
	await writeFile(join(DATA, name), `${JSON.stringify(value, null, "\t")}\n`);
}

/**
 * Un appel, une verdict. Toute exception (DNS, TLS, délai dépassé) vaut
 * « indisponible » — c'est bien ce que vit le client.
 */
async function probe(monitor) {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(monitor.url, {
			method: "GET",
			redirect: "manual",
			signal: controller.signal,
			headers: { "user-agent": "sendly-status-probe" },
		});
		return {
			up: monitor.expect.includes(response.status),
			status: response.status,
			ms: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			up: false,
			status: null,
			ms: Date.now() - startedAt,
			error: String(error?.name ?? error),
		};
	} finally {
		clearTimeout(timer);
	}
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

async function main() {
	const { monitors } = await readJson("monitors.json", { monitors: [] });
	if (monitors.length === 0) {
		throw new Error("Aucune sonde configurée : data/monitors.json est vide.");
	}

	const previous = await readJson("status.json", { monitors: {} });
	const history = await readJson("history.json", {});
	const incidents = await readJson("incidents.json", { open: {}, past: [] });

	const checkedAt = new Date().toISOString();
	const day = today();
	const results = {};

	for (const monitor of monitors) {
		const result = await probe(monitor);
		results[monitor.id] = { ...result, checkedAt };

		// Agrégat journalier : on compte les succès sur le nombre de mesures.
		// 90 entrées par service, quelle que soit la fréquence de sondage.
		const days = history[monitor.id] ?? [];
		const entry = days.find((d) => d.date === day);
		if (entry) {
			entry.total += 1;
			entry.up += result.up ? 1 : 0;
		} else {
			days.push({ date: day, total: 1, up: result.up ? 1 : 0 });
		}
		history[monitor.id] = days.slice(-HISTORY_DAYS);

		// Incidents : déduits des CHANGEMENTS d'état. Une panne qui dure ne
		// crée pas un incident par sondage, elle en prolonge un seul.
		const wasUp = previous.monitors?.[monitor.id]?.up ?? true;
		if (wasUp && !result.up) {
			incidents.open[monitor.id] = {
				monitor: monitor.id,
				name: monitor.name,
				startedAt: checkedAt,
				status: result.status,
			};
		} else if (!wasUp && result.up && incidents.open[monitor.id]) {
			incidents.past.unshift({
				...incidents.open[monitor.id],
				endedAt: checkedAt,
			});
			delete incidents.open[monitor.id];
			incidents.past = incidents.past.slice(0, 50);
		}
	}

	const allUp = Object.values(results).every((r) => r.up);

	await writeJson("status.json", {
		checkedAt,
		allUp,
		monitors: results,
	});
	await writeJson("history.json", history);
	await writeJson("incidents.json", incidents);

	// Sortie lisible dans le journal du workflow : un échec doit se voir sans
	// ouvrir les fichiers.
	for (const monitor of monitors) {
		const r = results[monitor.id];
		console.log(
			`${r.up ? "OK  " : "HS  "} ${monitor.name.padEnd(20)} ${String(r.status ?? r.error).padEnd(8)} ${r.ms} ms`,
		);
	}
	console.log(allUp ? "\nTous les services répondent." : "\nAu moins un service ne répond pas.");
}

await main();
