const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let bracket = { rounds: [] };
let votes = { A: 0, B: 0 };
let voteTimer = null;

let votingOpen = false;          // 🔥 Empêche de voter avant VOTE
let votedUsers = new Set();      // 🔥 Vote unique

/* ---------------------------------------------------------
   Mélange aléatoire
--------------------------------------------------------- */
function shuffle(array) {
    let a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* ---------------------------------------------------------
   Génération automatique du bracket (VERSION PRO)
--------------------------------------------------------- */
function generateBracket(crews) {
    const total = crews.length;

    if (total === 1) {
        bracket.rounds = [
            [{ a: crews[0], b: null, winner: crews[0] }]
        ];
        return bracket;
    }

    if (total === 2) {
        bracket.rounds = [
            [{ a: crews[0], b: crews[1], winner: null }]
        ];
        return bracket;
    }

    const shuffled = shuffle(crews);

    let p = 1;
    while (p < total) p *= 2;

    const slots = p;
    const seedsNeeded = slots - total;

    const seeds = shuffled.slice(0, seedsNeeded);
    const qualifiers = shuffled.slice(seedsNeeded);

    const qualMatches = Math.floor(qualifiers.length / 2);

    const round0 = [];

    for (let i = 0; i < qualMatches; i++) {
        round0.push({
            a: qualifiers[i * 2],
            b: qualifiers[i * 2 + 1],
            winner: null
        });
    }

    const round1 = [];
    let qIndex = 0;

    seeds.forEach(seed => {
        if (qIndex < qualMatches) {
            round1.push({
                a: seed,
                b: "QUAL_WINNER_" + qIndex++,
                winner: null
            });
        }
    });

    const remainingSeeds = seeds.slice(qIndex);
    for (let i = 0; i < remainingSeeds.length; i += 2) {
        if (remainingSeeds[i + 1]) {
            round1.push({
                a: remainingSeeds[i],
                b: remainingSeeds[i + 1],
                winner: null
            });
        }
    }

    while (qIndex < qualMatches) {
        const a = "QUAL_WINNER_" + qIndex++;
        const b = qIndex < qualMatches ? "QUAL_WINNER_" + qIndex++ : null;

        round1.push({ a, b, winner: null });
    }

    bracket.rounds = [];
    if (round0.length > 0) bracket.rounds.push(round0);
    bracket.rounds.push(round1);

    let current = round1;
    while (current.length > 1) {
        const next = [];
        for (let i = 0; i < current.length; i += 2) {
            next.push({ a: null, b: null, winner: null });
        }
        bracket.rounds.push(next);
        current = next;
    }

    return bracket;
}

/* ---------------------------------------------------------
   Propagation des gagnants (VERSION PRO)
--------------------------------------------------------- */
function propagateWinner(round, index, winner) {
    bracket.rounds[round][index].winner = winner;

    if (round + 1 >= bracket.rounds.length) return;

    const nextIndex = Math.floor(index / 2);
    const nextMatch = bracket.rounds[round + 1][nextIndex];

    if (nextMatch.a && nextMatch.a.startsWith("QUAL_WINNER_")) {
        nextMatch.a = winner;
        return;
    }

    if (nextMatch.b && nextMatch.b.startsWith("QUAL_WINNER_")) {
        nextMatch.b = winner;
        return;
    }

    const isA = index % 2 === 0;
    if (isA) nextMatch.a = winner;
    else nextMatch.b = winner;
}

/* ---------------------------------------------------------
   SOCKET.IO
--------------------------------------------------------- */
io.on("connection", (socket) => {

    socket.emit("bracketUpdate", bracket);

    /* Génération */
    socket.on("generateBracket", (crews) => {
        bracket = generateBracket(crews);
        io.emit("bracketUpdate", bracket);
    });

    /* Reset */
    socket.on("resetBracket", () => {
        bracket = { rounds: [] };
        io.emit("bracketUpdate", bracket);
    });

    /* DUEL */
    socket.on("launchDuel", ({ round, index }) => {
        const match = bracket.rounds[round][index];

        // 🔥 IMPORTANT : le duel commence → le vote n'est PAS ouvert
        votingOpen = false;
        votedUsers.clear();

        io.emit("duelStarted", { match: { ...match, round, index } });
    });

    /* VOTE */
    socket.on("startVoteForMatch", ({ round, index, duration }) => {
        const match = bracket.rounds[round][index];

        // 🔥 Ouvrir le vote
        votingOpen = true;
        votedUsers.clear();
        votes = { A: 0, B: 0 };

        io.emit("voteStarted", { match: { ...match, round, index } });

        let remaining = duration;
        clearInterval(voteTimer);

        voteTimer = setInterval(() => {
            remaining--;

            io.emit("voteProgress", { remaining, total: duration });

            if (remaining <= 0) {
                clearInterval(voteTimer);

                votingOpen = false;

                const winner = votes.A > votes.B ? match.a : match.b;

                propagateWinner(round, index, winner);

                io.emit("winnerAnnounced", { winner });
                io.emit("bracketUpdate", bracket);
                io.emit("voteEnded");
            }
        }, 1000);
    });

    /* VOTE UNIQUE */
    socket.on("vote", ({ choice }) => {
        if (!votingOpen) return;

        if (votedUsers.has(socket.id)) return;

        votedUsers.add(socket.id);

        if (choice === "A") votes.A++;
        else votes.B++;

        io.emit("update", votes);
    });
});

/* ---------------------------------------------------------
   Lancement serveur
--------------------------------------------------------- */
server.listen(process.env.PORT || 3000, () => {
    console.log("Serveur lancé");
});

