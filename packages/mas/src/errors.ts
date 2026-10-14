/** A checked refusal raised before this operation invokes opaque or native effectful work. */
export class MasRequestDenied extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MasRequestDenied";
	}
}
