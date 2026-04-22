import "@stdlib/deploy";
import "@stdlib/ownable";

// ── Messages ──────────────────────────────────────────────────────────────────
message(0x7370696e) Spin {}
message(0x636c6169) Claim {}
message(0x73656564) Seed {}

message SpinResult {
    tier:  Int as uint8;
    prize: Int as coins;
}

// ── Contract ──────────────────────────────────────────────────────────────────
contract SpinMint with Deployable, Ownable {

    owner:      Address;
    jackpot:    Int as coins;
    totalSpins: Int as uint32;

    claimable: map<Address, Int as coins>;
    lastWin:   map<Address, Int as uint64>;

    init(owner: Address) {
        self.owner      = owner;
        self.jackpot    = 0;
        self.totalSpins = 0;
    }

    receive(msg: Spin) {
        let ctx: Context = context();
        let spinCost: Int = ton("1");
        require(ctx.value >= spinCost + ton("0.05"), "Send at least 1.05 TON");

        self.jackpot    = self.jackpot + spinCost * 70 / 100;
        self.totalSpins = self.totalSpins + 1;

        nativeRandomizeLt();
        let rand: Int = abs(nativeRandom()) % 10000;

        let sender: Address = ctx.sender;
        let tier:   Int = 4;
        let prize:  Int = 0;

        if (rand < 200) {
            tier  = 0;
            prize = self.jackpot;
            self.jackpot = 0;
        } else if (rand < 700) {
            tier  = 1;
            prize = ton("5");
        } else if (rand < 2200) {
            tier  = 2;
            prize = ton("1.5");
        } else if (rand < 2700) {
            tier  = 5;
            prize = 0;
        } else {
            tier  = 4;
            prize = 0;
        }

        if (prize > 0) {
            let maybeVal: Int? = self.claimable.get(sender);
            let current: Int = maybeVal != null ? maybeVal!! : 0;
            self.claimable.set(sender, current + prize);
            self.lastWin.set(sender, now());
        }

        emit(SpinResult{ tier: tier, prize: prize }.toCell());

        let excess: Int = ctx.value - spinCost - ton("0.05");
        if (excess > 0) {
            send(SendParameters{
                to:    sender,
                value: excess,
                mode:  SendIgnoreErrors
            });
        }
    }

    receive(msg: Claim) {
        let sender: Address = context().sender;
        let maybeAmt: Int? = self.claimable.get(sender);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        require(amount > 0, "Nothing to claim");

        let maybeWon: Int? = self.lastWin.get(sender);
        let won: Int = maybeWon != null ? maybeWon!! : 0;
        require(now() - won <= 604800, "Winnings expired");

        self.claimable.set(sender, 0);
        send(SendParameters{
            to:     sender,
            value:  amount,
            bounce: false,
            mode:   SendIgnoreErrors
        });
    }

    receive(msg: Seed) {
        self.requireOwner();
        self.jackpot = self.jackpot + context().value - ton("0.05");
    }

    receive("sweep") {
        self.requireOwner();
    }

    get fun jackpot(): Int { return self.jackpot; }
    get fun totalSpins(): Int { return self.totalSpins; }

    get fun claimable(user: Address): Int {
        let v: Int? = self.claimable.get(user);
        return v != null ? v!! : 0;
    }

    get fun lastWin(user: Address): Int {
        let v: Int? = self.lastWin.get(user);
        return v != null ? v!! : 0;
    }
}
