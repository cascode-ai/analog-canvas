export function NetlistProfileCode({
  text,
  error,
  onChange,
}: {
  text: string;
  error: string | null;
  onChange(text: string): void;
}) {
  return (
    <section
      className="netlist-profile-code"
      aria-label="Netlist configuration"
    >
      <h2>Netlist configuration</h2>
      <p>
        Edit or paste the complete output JSON. Format and formal-port spelling
        are presentation choices; device bindings and parameters always come
        from the Project.
      </p>
      <textarea
        aria-label="Netlist configuration JSON"
        value={text}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={!!error}
      />
      {error ? (
        <p role="alert">
          {error} Copying is paused until the configuration is valid.
        </p>
      ) : (
        <p>
          Saved in this browser. It never changes the circuit being exported.
        </p>
      )}
    </section>
  );
}
