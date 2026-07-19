// Ghidra headless post-script: find symbols containing a case-insensitive term and print their references.
// Usage: analyzeHeadless ... -postScript FindSymbolRefs.java Squad
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;

public final class FindSymbolRefs extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("expected one symbol-name fragment");
        String needle = args[0].toLowerCase();
        SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
        while (symbols.hasNext() && !monitor.isCancelled()) {
            Symbol symbol = symbols.next();
            if (!symbol.getName(true).toLowerCase().contains(needle)) continue;
            println("symbol " + symbol.getName(true) + " @ " + symbol.getAddress());
            ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(symbol.getAddress());
            while (references.hasNext()) {
                Reference reference = references.next();
                Function function = getFunctionContaining(reference.getFromAddress());
                println("  " + reference.getFromAddress() + " in " + (function == null ? "<none>" : function.getName()));
            }
        }
    }
}
