function isSkipOutput(output: string): boolean {
    return output
        .split(/\r?\n/)
        .some((line) => line.trim() === '[SKIP]');
}

export { isSkipOutput };
