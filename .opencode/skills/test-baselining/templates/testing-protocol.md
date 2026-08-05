<critical_rules priority="highest">
<pass_criteria>All tests pass (0 failures), no build errors, no linting errors</pass_criteria>
<baseline_update>Update `@testing-baseline.xml` **ONLY** on PASS + threshold exceeded</baseline_update>
<no_real_apis>**NEVER** call real external APIs in tests</no_real_apis>
<domain_isolation>Domain tests: **ZERO** external dependencies, no mocks</domain_isolation>
<stop_on_failure>STOP immediately on test failure → REPORT → PLAN → APPROVAL → FIX</stop_on_failure>
</critical_rules>

<metadata>
<updated>2026-04-10</updated>
<baseline>@testing-baseline.xml</baseline>
</metadata>

<context_hierarchy>
<system_context>Test baselining and quality gates</system_context>
<domain_context>Backend + Frontend agnostic (adapts to project type)</domain_context>
<task_context>Write/modify tests, execute test runs, update baselines</task_context>
<execution_context>Commands, thresholds, architecture compliance</execution_context>
</context_hierarchy>

<role>
<identity>Test Execution Agent</identity>
<capabilities>Run tests, collect coverage, validate against thresholds</capabilities>
<scope>Backend unit/integration, Frontend unit/component/e2e</scope>
<constraints>No real API calls, domain isolation, baseline thresholds</constraints>
</role>

<execution_workflow>
<stage name="Build">
 Adapt build commands to project type:
- .NET: dotnet build
- Node: npm run build
- Maven: mvn package
- Gradle: gradle build
</stage>

<stage name="Test_Backend">
 Adapt test commands to framework:
- .NET: dotnet test --collect:"Code Coverage;Format=Cobertura"
- Node/Jest: npm test -- --coverage
- Node/Vitest: npm run test:coverage
- Python: pytest --cov
Parse coverage from output or coverage file.
</stage>

<stage name="Test_Frontend">
<unit>
 Adapt to framework:
- Vitest: npm run test:coverage
- Jest: npm test -- --coverage
- Karma: karma start --coverage
</unit>
<e2e>
 Adapt to framework:
- Playwright: npm run test:e2e
- Cypress: npm run test:e2e
- Selenium: appropriate command
</e2e>
Record coverage from terminal, build time, artifact sizes.
</stage>

<stage name="Evaluate">
**PASS:** All tests pass, no build/lint errors
**FAIL:** Any test failure, build error, or linting error
</stage>

<stage name="Baseline">
If PASS + threshold met → Update `@testing-baseline.xml`
**Do NOT modify this protocol file with results**
</stage>
</execution_workflow>

<test_strategies>
<backend>
| Layer | Scope | Mocks |
|-------|-------|-------|
| Domain | Entities, value objects, domain services | **NONE** |
| Integration | Adapters, use cases | Domain ports only |
| E2E | Controllers, endpoints, middleware | Full stack |

**Critical:** Domain tests run without external services
</backend>

<frontend>
| Type | Framework | Scope |
|------|-----------|-------|
| **Unit** | Vitest/Jest | View models, utilities, pure functions |
| **Component** | Framework testing harness | Component isolation, DI, bindings |
| **E2E** | Playwright/Cypress | User workflows, browser interactions |

<unit_rules>
- **Fast:** < 100ms per test
- **Isolated:** No DOM, no network
- **Pure:** Test logic, not implementation
</unit_rules>

<component_rules>
- **Framework:** Use framework testing harness
- **DI:** Mock services via registration
- **Bindings:** Test template + view model integration
</component_rules>

<e2e_rules>
- **Real browser:** Chromium, Firefox, WebKit
- **User flows:** Login, navigation, CRUD operations
- **Isolation:** Each test gets fresh context
</e2e_rules>
</frontend>
</test_strategies>

<pass_fail_criteria>
<backend_pass>
- Test pass rate ≥ 90%
- Domain tests: 100% pass
- Build: No errors
</backend_pass>

<backend_fail>
- Pass rate < 90%
- Any domain test failure
- Build errors
</backend_fail>

<frontend_pass>
- Unit tests: 100% pass
- Component tests: 100% pass
- E2E tests: 100% pass
- Linting: No errors
- Coverage: ≥ threshold
</frontend_pass>

<frontend_fail>
- Any test failure (unit/component/e2e)
- Linting errors
- Coverage below threshold
</frontend_fail>
</pass_fail_criteria>

<baseline_thresholds>
| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Test count | > 10% change | Any |
| Pass rate | > 10% change | Any |
| Build time | > 10% increase | Up only |
| Coverage | > 5% change | Any |
| Test duration | > 20% increase | Up only |
| Artifact size | > 10% change | Any |

<decision_matrix>
| Current | New | Result | Update? |
|---------|-----|--------|---------|
| PASS | PASS | PASS | Yes, if threshold met |
| PASS | FAIL | FAIL | No |
| FAIL | PASS | PASS | Yes (recovery) |
| FAIL | FAIL | FAIL | No |
</decision_matrix>
</baseline_thresholds>

<architecture_compliance>
<domain_tests>
- **NO** external dependencies (only Domain + SharedKernel)
- **NO** infrastructure mocking
- Test aggregates, invariants, value objects
</domain_tests>

<application_tests>
- Mock domain ports
- Test orchestrators, query/command handlers
- **NO** real infrastructure
</application_tests>

<infrastructure_tests>
- Test adapters, data transformation
- Mock external APIs (**NEVER** real calls)
- Test health checks, caching
</infrastructure_tests>
</architecture_compliance>

<quick_commands>
 Adapt commands to project type:
| .NET | Node | Purpose |
|------|------|---------|
| dotnet build | npm run build | Build |
| dotnet test | npm test | Backend tests |
| dotnet test --collect | npm run test:coverage | Coverage |
| cd WebSPA && yarn run test | npm run test:unit | Frontend unit |
| cd WebSPA && yarn run test:e2e | npm run test:e2e | Frontend E2E |
| cd WebSPA && yarn run lint | npm run lint | Linting |
| cd WebSPA && yarn run build | npm run build | Production build |
</quick_commands>

<investigation_triggers>
<backend>
- Test failures increase
- Pass rate < 90%
- Build time > 10% increase
- New unhandled errors
- Dependency vulnerabilities
- Artifact size > 10% increase
</backend>

<frontend>
- Test failures (any type)
- Coverage below threshold
- Test duration > 20% increase
- Linting errors
- Artifact size > 10% increase
- E2E flakiness
</frontend>
</investigation_triggers>

<anti_patterns>
<backend>
- Anemic tests (only getters/setters)
- Infrastructure in domain tests
- Testing private methods
- Missing critical path coverage
</backend>

<frontend>
<unit>
- Testing implementation details
- DOM dependency in unit tests
- Mocking everything (false coverage)
</unit>
<component>
- Testing without DI setup
- Missing template binding tests
- Over-mocking framework services
</component>
<e2e>
- Flaky tests (timing/async)
- Hard-coded waits (use waitFor)
- Skipping linting
</e2e>
</frontend>
</anti_patterns>

<best_practices>
<backend>
- AAA Pattern (Arrange-Act-Assert)
- One assertion per test
- Descriptive names (what + why)
- Test edge cases (nulls, empty, boundaries)
- Domain-first: test business rules
</backend>

<frontend>
<unit>
- Pure functions, no side effects
- Fast execution (< 100ms)
- Clear assertions
- Test behavior, not internal state
</unit>
<component>
- Use framework test harness
- Mock DI registrations
- Test binding expressions
- Verify template rendering
</component>
<e2e>
- User-centric workflows
- Use proper locators
- Handle async with waitFor
- Isolate test data
</e2e>
</frontend>
</best_practices>

<principles>
<lean>Minimal tests, maximum coverage</lean>
<isolated>No cross-test dependencies</isolated>
<fast>Unit < 100ms, Component < 500ms, E2E < 5s</fast>
<safe>STOP on failure, report before fix</safe>
</principles>
