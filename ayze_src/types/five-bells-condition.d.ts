declare module "five-bells-condition" {
    export class PreimageSha256 {
        setPreimage(preimage: Buffer): void;
        serializeBinary(): Buffer;
        getConditionBinary(): Buffer;
    }
}