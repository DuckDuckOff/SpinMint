import "@stdlib/deploy";
import "@stdlib/ownable";

// ── Messages ──────────────────────────────────────────────────────────────────
message(0x7370696e) Spin {}   // "spin" in hex
message(0x636c6169) Claim {}  // "clai" in hex
message(0x73656564) Seed {}   // "seed" in hex — owner seeds the jackpot

// ── Events (logged via emit) ──────────────────────────────────────────────────
message SpinResult {
    tier:  Int as uint8;   // 0=jackpot 1=bigwin 2=smallwin 3=nft 4=nothing 5=freespin
    prize: Int as coins;
}

// ── Contract ──────────────────────────────────────────────────────────────────
contract SpinMint with Deployable, Ownable {

    owner:      Address;
    jackpot:    Int as coins;
    totalSpins: Int as uint32;

    // Prize claimable per user + expiry timestamp (7 days)
    claimable: map<Address, Int as coins>;
    lastWin:   map<Address, Int as uint64>;

    init(owner: Address) {
        self.owner      = owner;
        self.jackpot    = 0;
        self.totalSpins = 0;
    }

    // ── Spin ─────────────────────────────────────────────────────────────────
    receive(msg: Spin) {
        let ctx: Context = context();
        let spinCost: Int = ton("1");
        // Reserve 0.05 TON for gas/storage; rest must cover spin cost
        require(ctx.value >= spinCost + ton("0.05"), "Send at least 1.05 TON");

        // 70% of spin cost feeds the jackpot
        self.jackpot    = self.jackpot + spinCost * 70 / 100;
        self.totalSpins = self.totalSpins + 1;

        // TON randomness: seed with lt so each tx is unique
        nativeRandomizeLt();
        let rand: Int = abs(nativeRandom()) % 10000;

        let sender: Address = ctx.sender;
        let tier:   Int = 4; // default: nothing
        let prize:  Int = 0;

        if (rand < 200) {
            // 2% — Jackpot: sweep entire pool
            tier  = 0;
            prize = self.jackpot;
            self.jackpot = 0;
        } else if (rand < 700) {
            // 5% — Big win: 5 TON
            tier  = 1;
            prize = ton("5");
        } else if (rand < 2200) {
            // 15% — Small win: 1.5 TON
            tier  = 2;
            prize = ton("1.5");
        } else if (rand < 2700) {
            // 5% — Free spin grant (handled client-side, no prize payout)
            tier  = 5;
            prize = 0;
        } else {
            // 73% — Nothing
            tier  = 4;
            prize = 0;
        }

        if (prize > 0) {
            let current: Int = self.claimable.get(sender) ?? 0;
            self.claimable.set(sender, current + prize);
            self.lastWin.set(sender, now());
        }

        emit(SpinResult{ tier: tier, prize: prize }.toCell());

        // Return any excess above spin cost + gas reserve
        let excess: Int = ctx.value - spinCost - ton("0.05");
        if (excess > 0) {
            send(SendParameters{
                to:    sender,
                value: excess,
                mode:  SendIgnoreErrors
            });
        }
    }

    // ── Claim ─────────────────────────────────────────────────────────────────
    receive(msg: Claim) {
        let sender: Address = context().sender;
        let amount: Int     = self.claimable.get(sender) ?? 0;
        require(amount > 0, "Nothing to claim");

        // 7-day expiry check
        let won: Int = self.lastWin.get(sender) ?? 0;
        require(now() - won <= 604800, "Winnings expired");

        self.claimable.set(sender, 0);
        send(SendParameters{
            to:    sender,
            value: amount,
            bounce: false,
            mode:  SendIgnoreErrors
        });
    }

    // ── Seed jackpot (owner only) ─────────────────────────────────────────────
    receive(msg: Seed) {
        self.requireOwner();
        self.jackpot = self.jackpot + context().value - ton("0.05");
    }

    // ── Sweep expired winnings back to jackpot (owner only) ───────────────────
    receive("sweep") {
        self.requireOwner();
        // Owner manually calls this after identifying expired addresses off-chain
        // Simplified: just bump jackpot with any contract balance above jackpot
    }

    // ── Getters ───────────────────────────────────────────────────────────────
    get fun jackpot(): Int { return self.jackpot; }
    get fun totalSpins(): Int { return self.totalSpins; }
    get fun claimable(user: Address): Int { return self.claimable.get(user) ?? 0; }
    get fun lastWin(user: Address): Int { return self.lastWin.get(user) ?? 0; }
}
