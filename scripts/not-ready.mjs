const command = process.argv[2] ?? "command";

console.error(
  `PaperTrail ${command} is not implemented yet. ` +
    "This command intentionally fails so an unfinished capability cannot be mistaken for verified behavior. " +
    "See docs/IMPLEMENTATION_STATUS.md.",
);
process.exitCode = 1;

